'use strict';

// 台词库：按时间 / 心情 / 亲密度挑选，避免连续重复

const POOLS = {
  pet: [
    '呼噜呼噜～',
    '喵～',
    '再摸一下嘛',
    '头可以摸，尾巴不行',
    '舒服…',
    '你手好暖',
    '（眯起眼睛）',
  ],
  high: [
    '今天也要一直在一起哦',
    '我等你回来好久了',
    '不许走开',
    '（把头蹭过来）',
    '你是我的',
  ],
  low: [
    '……',
    '哼。',
    '（把头扭开）',
    '好久没理我了',
    '有点难过',
  ],
  annoyed: [
    '别戳啦！',
    '生气了！',
    '再戳就咬你',
    '（炸毛）',
    '走开走开',
  ],
  grumpy: [
    '哼。',
    '不理你。',
    '（背过身）',
  ],
  fed: [
    '好吃！',
    '小鱼干！',
    '还有吗？',
    '（嚼嚼嚼）',
  ],
  full: [
    '吃不下了…',
    '肚子圆了',
    '留着下次吃',
  ],
  wake: [
    '唔…醒了',
    '（伸懒腰）',
    '找我干嘛',
    '睡得好香',
  ],
  idle: [
    '在忙吗？',
    '看看窗外',
    '（舔爪子）',
    '今天天气不错',
    '有点无聊',
    '（尾巴晃了晃）',
  ],
  morning: [
    '早上好',
    '又是新的一天',
    '（打哈欠）',
  ],
  night: [
    '夜深了，早点睡',
    '还不睡吗？',
    '（困了）',
  ],
  late: [
    '这么晚还不睡？',
    '陪你熬一会儿',
    '眼睛要坏了',
  ],
};

function bucketByHour(hour) {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 23 || hour < 5) return 'late';
  if (hour >= 20) return 'night';
  return 'idle';
}

function poolFor(ctx) {
  if (ctx.kind === 'pet') {
    if (ctx.mood < 35) return POOLS.low;
    if (ctx.affinity >= 60) return POOLS.high;
    return POOLS.pet;
  }
  if (ctx.kind === 'idle') {
    const bucket = bucketByHour(ctx.hour);
    return POOLS[bucket] || POOLS.idle;
  }
  return POOLS[ctx.kind] || POOLS.idle;
}

function pickLine(ctx = {}, random = Math.random) {
  const pool = poolFor(ctx);
  if (!pool || pool.length === 0) return '';
  const candidates = ctx.last ? pool.filter((line) => line !== ctx.last) : pool;
  const usable = candidates.length > 0 ? candidates : pool;
  return usable[Math.floor(random() * usable.length) % usable.length];
}

module.exports = { POOLS, bucketByHour, poolFor, pickLine };
