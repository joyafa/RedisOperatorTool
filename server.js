const express = require('express');
const Redis = require('ioredis');
const path = require('path');

const isPackaged = process.env.APP_IS_PACKAGED === 'true' || process.env.NODE_ENV === 'production';
const resourcesPath = process.env.RESOURCES_PATH || __dirname;

const logger = isPackaged 
  ? require(path.join(resourcesPath, 'logger'))
  : require('./logger');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

const publicPath = isPackaged 
  ? path.join(resourcesPath, 'public')
  : path.join(__dirname, 'public');
logger.info('Public path:', publicPath);
app.use(express.static(publicPath));

app.use((req, res, next) => {
  const start = Date.now();
  const logBody = { ...req.body };
  if (logBody.password) logBody.password = '******';
  logger.info(`Request: ${req.method} ${req.path}`, logBody);
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`Response: ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// 连接池 - 支持多个 Redis 实例
const connections = new Map();

function getConnection(id) {
  return connections.get(id);
}

function createConnection({ id, host, port, password, db, testMode = false }) {
  const client = new Redis({
    host: host || '127.0.0.1',
    port: parseInt(port) || 6379,
    password: password || undefined,
    db: parseInt(db) || 0,
    lazyConnect: true,
    connectTimeout: 10000,
    retryStrategy(times) {
      if (testMode) return null;
      const delay = Math.min(times * 500, 5000);
      return delay;
    },
    maxRetriesPerRequest: testMode ? 0 : 1,
  });

  client.on('error', (err) => {
    logger.error(`Redis [${id}] error:`, err.message);
  });

  client.on('close', () => {
    logger.info(`Redis [${id}] connection closed`);
    connections.delete(id);
  });

  client.on('connect', () => {
    logger.info(`Redis [${id}] connected successfully`);
  });

  client.on('ready', () => {
    logger.info(`Redis [${id}] ready`);
  });

  connections.set(id, client);
  return client;
}

// ============ 路由 ============

// 连接测试
app.post('/api/connect', async (req, res) => {
  const { host, port, password, db } = req.body;
  const connId = `${host}:${port || 6379}/${db || 0}`;

  logger.info(`Attempting to connect to Redis: ${connId}`);

  try {
    let firstError = null;

    const testClient = new Redis({
      host: host || '127.0.0.1',
      port: parseInt(port) || 6379,
      password: password || undefined,
      db: parseInt(db) || 0,
      lazyConnect: true,
      connectTimeout: 10000,
      retryStrategy: () => null,
      maxRetriesPerRequest: 0,
    });

    testClient.on('error', (err) => {
      logger.error(`Redis test connection error: ${connId}`, err.message);
      if (!firstError) firstError = err;
    });

    try {
      logger.debug(`Calling client.connect() for: ${connId}`);
      await testClient.connect();
    } catch (err) {
      logger.error(`Redis connect failed: ${connId}`, err.message);
      if (!firstError) firstError = err;
      try { testClient.disconnect(); } catch {}
      res.json({ success: false, message: formatRedisError(firstError) });
      return;
    }

    if (firstError) {
      logger.error(`Redis connection error after connect: ${connId}`, firstError.message);
      try { testClient.disconnect(); } catch {}
      res.json({ success: false, message: formatRedisError(firstError) });
      return;
    }

    try {
      logger.debug(`Sending PING to: ${connId}`);
      const pong = await testClient.ping();
      logger.debug(`Received PONG from: ${connId}`);
      
      logger.debug(`Getting server info: ${connId}`);
      const info = await testClient.info('server');
      const version = info.match(/redis_version:(.+)/)?.[1]?.trim() || 'unknown';
      logger.info(`Redis server version: ${version}`);

      testClient.disconnect();
      logger.debug(`Test client disconnected: ${connId}`);

      let client = getConnection(connId);
      if (!client || client.status === 'end' || client.status === 'close') {
        logger.info(`Creating new connection: ${connId}`);
        client = createConnection({ id: connId, host, port, password, db });
        await client.connect();
      }

      logger.info(`Connection successful: ${connId}`);
      res.json({ success: true, connId, message: pong, version });
    } catch (err) {
      logger.error(`Redis post-connect error: ${connId}`, err.message);
      try { testClient.disconnect(); } catch {}
      connections.delete(connId);
      res.json({ success: false, message: formatRedisError(err) });
    }
  } catch (err) {
    logger.error(`Redis connection exception: ${connId}`, err.message);
    connections.delete(connId);
    res.json({ success: false, message: formatRedisError(err) });
  }
});

function formatRedisError(err) {
  const msg = err.message || String(err);
  if (msg.includes('ECONNREFUSED')) {
    return '连接被拒绝，请检查 Redis 服务是否启动，以及主机和端口是否正确';
  }
  if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) {
    return '连接超时，请检查网络连接和 Redis 服务状态';
  }
  if (msg.includes('ENOTFOUND') || msg.includes('EAI_AGAIN')) {
    return '无法解析主机地址，请检查主机名是否正确';
  }
  if (msg.includes('NOAUTH') || msg.includes('password') || msg.includes('AUTH')) {
    return '密码错误，请检查 Redis 密码';
  }
  if (msg.includes('ERR invalid DB index') || msg.includes('invalid database')) {
    return '数据库索引无效，请检查 DB 编号';
  }
  if (msg.includes('Connection is closed')) {
    return '连接已关闭，请重试';
  }
  return msg;
}

// 获取数据库列表 (dbsize)
app.post('/api/databases', async (req, res) => {
  try {
    const { connId } = req.body;
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    const results = [];
    
    try {
      const info = await client.info('keyspace');
      const lines = info.split('\n');
      const dbSizeMap = {};
      
      for (const line of lines) {
        const match = line.match(/^db(\d+):keys=(\d+)/);
        if (match) {
          dbSizeMap[parseInt(match[1])] = parseInt(match[2]);
        }
      }
      
      for (let i = 0; i < 16; i++) {
        results.push({ db: i, keys: dbSizeMap[i] !== undefined ? dbSizeMap[i] : -1 });
      }
    } catch (err) {
      logger.warn(`Failed to get keyspace info: ${err.message}, falling back to single dbsize`);
      const size = await client.dbsize();
      for (let i = 0; i < 16; i++) {
        results.push({ db: i, keys: i === client.options.db ? size : -1 });
      }
    }

    res.json({ success: true, databases: results });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// 选择数据库
app.post('/api/select-db', async (req, res) => {
  try {
    const { connId, db } = req.body;
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    await client.select(parseInt(db));
    const size = await client.dbsize();
    res.json({ success: true, db, keysCount: size });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// 获取所有 key（分页）
app.post('/api/keys', async (req, res) => {
  try {
    const { connId, pattern = '*', cursor = 0, count = 100 } = req.body;
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    const MAX_COUNT = 1000;
    const scanCount = Math.min(Math.max(parseInt(count), 10), MAX_COUNT);

    const [newCursor, keys] = await client.scan(
      parseInt(cursor),
      'MATCH',
      pattern,
      'COUNT',
      scanCount
    );

    // 获取每个 key 的类型
    const keyInfos = [];
    if (keys.length > 0) {
      const pipeline = client.pipeline();
      for (const key of keys) {
        pipeline.type(key);
        pipeline.ttl(key);
      }
      const results = await pipeline.exec();

      for (let i = 0; i < keys.length; i++) {
        const typeResult = results[i * 2];
        const ttlResult = results[i * 2 + 1];
        const typeRes = typeResult && typeResult[0] === null ? typeResult[1] : 'unknown';
        const ttlRes = ttlResult && ttlResult[0] === null ? ttlResult[1] : -1;

        keyInfos.push({
          key: keys[i],
          type: typeRes,
          ttl: ttlRes,
        });
      }
    }

    res.json({
      success: true,
      cursor: parseInt(newCursor),
      keys: keyInfos,
      hasMore: parseInt(newCursor) !== 0,
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// 获取指定 key 的值
app.post('/api/get', async (req, res) => {
  try {
    const { connId, key } = req.body;
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    const MAX_BATCH_SIZE = 500;

    const [type, ttl] = await Promise.all([
      client.type(key),
      client.ttl(key)
    ]);

    let detail;

    switch (type) {
      case 'string': {
        const val = await client.get(key);
        detail = { value: val };
        try {
          detail.jsonValue = JSON.parse(val);
          detail.isJson = true;
        } catch {}
        break;
      }
      case 'list': {
        const len = await client.llen(key);
        const start = 0;
        const stop = Math.min(len - 1, MAX_BATCH_SIZE - 1);
        const items = await client.lrange(key, start, stop);
        detail = { length: len, items, showCount: items.length };
        break;
      }
      case 'hash': {
        const len = await client.hlen(key);
        const [, scanResult] = await client.hscan(key, 0, 'COUNT', MAX_BATCH_SIZE);
        const data = {};
        for (let i = 0; i < scanResult.length; i += 2) {
          data[scanResult[i]] = scanResult[i + 1];
        }
        detail = { length: len, fields: data, showCount: Object.keys(data).length };
        break;
      }
      case 'set': {
        const len = await client.scard(key);
        const [, members] = await client.sscan(key, 0, 'COUNT', MAX_BATCH_SIZE);
        detail = { length: len, members, showCount: members.length };
        break;
      }
      case 'zset': {
        const len = await client.zcard(key);
        const items = await client.zrange(key, 0, MAX_BATCH_SIZE - 1, 'WITHSCORES');
        const parsed = [];
        for (let i = 0; i < items.length; i += 2) {
          parsed.push({ member: items[i], score: parseFloat(items[i + 1]) });
        }
        detail = { length: len, items: parsed, showCount: parsed.length };
        break;
      }
      case 'stream': {
        const len = await client.xlen(key);
        const entries = await client.xrange(key, '-', '+', 20);
        const parsed = entries.map(([id, fields]) => ({
          id,
          fields: Object.fromEntries(
            Array.isArray(fields)
              ? fields.reduce((acc, val, idx, arr) => { if (idx % 2 === 0) acc.push([val, arr[idx + 1]]); return acc; }, [])
              : Object.entries(fields)
          )
        }));
        detail = { length: len, entries: parsed, showCount: parsed.length };
        break;
      }
      default:
        detail = { value: `(unsupported type: ${type})` };
    }

    res.json({ success: true, key, type, ttl, detail });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// 设置 key（string 类型）
app.post('/api/set', async (req, res) => {
  try {
    const { connId, key, value, ex, px, nx, xx } = req.body;
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    const options = {};
    if (ex) options.EX = parseInt(ex);
    if (px) options.PX = parseInt(px);
    if (nx) options.NX = true;
    if (xx) options.XX = true;

    const result = await client.set(key, value, options);
    res.json({ success: true, result });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// 删除 key
app.post('/api/del', async (req, res) => {
  try {
    const { connId, keys } = req.body;
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    const MAX_DELETE_BATCH = 100;
    const keyArray = Array.isArray(keys) ? keys : [keys];
    
    if (keyArray.length > MAX_DELETE_BATCH) {
      let totalDeleted = 0;
      for (let i = 0; i < keyArray.length; i += MAX_DELETE_BATCH) {
        const batch = keyArray.slice(i, i + MAX_DELETE_BATCH);
        totalDeleted += await client.del(...batch);
      }
      res.json({ success: true, deleted: totalDeleted });
    } else {
      const result = await client.del(...keyArray);
      res.json({ success: true, deleted: result });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// 设置过期时间
app.post('/api/expire', async (req, res) => {
  try {
    const { connId, key, seconds } = req.body;
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    const result = await client.expire(key, parseInt(seconds));
    res.json({ success: true, result });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// 重命名 key
app.post('/api/rename', async (req, res) => {
  try {
    const { connId, oldKey, newKey } = req.body;
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    const result = await client.rename(oldKey, newKey);
    res.json({ success: true, result: 'OK' });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// List 操作: 添加元素
app.post('/api/list/push', async (req, res) => {
  try {
    const { connId, key, direction, values } = req.body;
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    const MAX_PUSH_SIZE = 1000;
    const valueArray = Array.isArray(values) ? values.slice(0, MAX_PUSH_SIZE) : [values];

    let result;
    if (direction === 'left') {
      result = await client.lpush(key, ...valueArray);
    } else {
      result = await client.rpush(key, ...valueArray);
    }
    res.json({ success: true, length: result });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// List 操作: 移除元素
app.post('/api/list/pop', async (req, res) => {
  try {
    const { connId, key, direction, count } = req.body;
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    let result;
    if (parseInt(count) > 1) {
      result = direction === 'left'
        ? await client.lpop(key, count)
        : await client.rpop(key, count);
    } else {
      result = direction === 'left'
        ? await client.lpop(key)
        : await client.rpop(key);
    }
    res.json({ success: true, value: result });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// List 操作: 按索引设置元素
app.post('/api/list/set', async (req, res) => {
  try {
    const { connId, key, index, value } = req.body;
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    await client.lset(key, parseInt(index), value);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// List 操作: 按索引删除元素
app.post('/api/list/remove-index', async (req, res) => {
  try {
    const { connId, key, index } = req.body;
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    // Use LREM with a temp marker approach: LSET -> LREM
    const idx = parseInt(index);
    const item = await client.lindex(key, idx);
    if (item === null) return res.json({ success: false, message: 'Index out of range' });

    const marker = `__MARKER_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
    await client.lset(key, idx, marker);
    await client.lrem(key, 1, marker);
    res.json({ success: true, removedValue: item });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Hash 操作: 设置字段
app.post('/api/hash/set', async (req, res) => {
  try {
    const { connId, key, data } = req.body;
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    const entries = Object.entries(data).flat();
    const result = await client.hset(key, ...entries);
    res.json({ success: true, addedFields: result });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Hash 操作: 删除字段
app.post('/api/hash/del', async (req, res) => {
  try {
    const { connId, key, fields } = req.body;
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    const MAX_DELETE_SIZE = 1000;
    const fieldArray = Array.isArray(fields) ? fields.slice(0, MAX_DELETE_SIZE) : [fields];

    const result = await client.hdel(key, ...fieldArray);
    res.json({ success: true, deleted: result });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Set 操作: 添加成员
app.post('/api/set/add', async (req, res) => {
  try {
    const { connId, key, members } = req.body;
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    const MAX_ADD_SIZE = 1000;
    const memberArray = Array.isArray(members) ? members.slice(0, MAX_ADD_SIZE) : [members];

    const result = await client.sadd(key, ...memberArray);
    res.json({ success: true, added: result });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Set 操作: 删除成员
app.post('/api/set/remove', async (req, res) => {
  try {
    const { connId, key, members } = req.body;
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    const MAX_REMOVE_SIZE = 1000;
    const memberArray = Array.isArray(members) ? members.slice(0, MAX_REMOVE_SIZE) : [members];

    const result = await client.srem(key, ...memberArray);
    res.json({ success: true, removed: result });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ZSet 操作: 添加成员
app.post('/api/zset/add', async (req, res) => {
  try {
    const { connId, key, members } = req.body; // members: [{score, member}]
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    const MAX_ADD_SIZE = 1000;
    const memberArray = Array.isArray(members) ? members.slice(0, MAX_ADD_SIZE) : [members];

    const args = memberArray.flatMap(m => [m.score, m.member]);
    const result = await client.zadd(key, ...args);
    res.json({ success: true, added: result });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ZSet 操作: 删除成员
app.post('/api/zset/remove', async (req, res) => {
  try {
    const { connId, key, members } = req.body;
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    const MAX_REMOVE_SIZE = 1000;
    const memberArray = Array.isArray(members) ? members.slice(0, MAX_REMOVE_SIZE) : [members];

    const result = await client.zrem(key, ...memberArray);
    res.json({ success: true, removed: result });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// 新增 Key 对话框：根据类型创建
app.post('/api/create', async (req, res) => {
  try {
    const { connId, key, type, value } = req.body;
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    switch (type) {
      case 'string':
        await client.set(key, value || '');
        break;
      case 'list':
        if (value && Array.isArray(value)) await client.rpush(key, ...value);
        break;
      case 'hash':
        if (value && typeof value === 'object') {
          const entries = Object.entries(value).flat();
          if (entries.length > 0) await client.hset(key, ...entries);
        }
        break;
      case 'set':
        if (value && Array.isArray(value)) await client.sadd(key, ...value);
        break;
      case 'zset':
        if (value && Array.isArray(value)) {
          const args = value.flatMap(m => [m.score, m.member]);
          if (args.length > 0) await client.zadd(key, ...args);
        }
        break;
      default:
        await client.set(key, value || '');
    }

    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// 断开连接
app.post('/api/disconnect', async (req, res) => {
  const { connId } = req.body;
  const client = getConnection(connId);
  if (client) {
    await client.quit();
    connections.delete(connId);
  }
  res.json({ success: true });
});

// 服务器信息
app.post('/api/info', async (req, res) => {
  try {
    const { connId, section } = req.body;
    const client = getConnection(connId);
    if (!client) return res.json({ success: false, message: '未连接' });

    const ALLOWED_SECTIONS = ['default', 'server', 'clients', 'memory', 'persistence', 'stats', 'replication', 'cpu', 'commandstats', 'latencystats', 'cluster', 'keyspace'];
    const safeSection = ALLOWED_SECTIONS.includes(section) ? section : 'default';

    const info = await client.info(safeSection);
    const parsed = {};
    info.split('\n').forEach(line => {
      if (line.includes(':')) {
        const [k, v] = line.split(':');
        if (k && v !== undefined) parsed[k.trim()] = v.trim();
      }
    });
    res.json({ success: true, info: parsed });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3210;
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Redis Operator server started at http://0.0.0.0:${PORT}`);
  logger.info(`Log directory: ${logger.getLogDir()}`);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err.message, err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection:', reason.message || reason);
});
