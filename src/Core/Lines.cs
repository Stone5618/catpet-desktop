using System;

namespace CatPet.Core
{
    /// <summary>台词库：按时间/心情/等级挑，避免连续重复。</summary>
    public static class Lines
    {
        private static readonly string[] Pet =
        {
            "呼噜呼噜～", "喵～", "再摸一下嘛", "头可以摸，尾巴不行",
            "舒服…", "你手好暖", "（眯起眼睛）"
        };

        private static readonly string[] High =
        {
            "今天也要一直在一起哦", "我等你回来好久了", "不许走开", "（把头蹭过来）"
        };

        private static readonly string[] Low =
        {
            "……", "哼。", "（把头扭开）", "好久没理我了"
        };

        private static readonly string[] Annoyed =
        {
            "别戳啦！", "生气了！", "再戳就咬你", "（炸毛）"
        };

        private static readonly string[] Grumpy =
        {
            "哼。", "不理你。", "（背过身）"
        };

        private static readonly string[] Fed = { "好吃！", "小鱼干！", "还有吗？", "（嚼嚼嚼）" };
        private static readonly string[] Full = { "吃不下了…", "肚子圆了", "留着下次吃" };
        private static readonly string[] Wake = { "唔…醒了", "（伸懒腰）", "找我干嘛", "睡得好香" };

        private static readonly string[] Idle =
        {
            "在忙吗？", "看看窗外", "（舔爪子）", "今天天气不错", "有点无聊", "（尾巴晃了晃）"
        };

        private static readonly string[] Morning = { "早上好", "又是新的一天", "（打哈欠）" };
        private static readonly string[] Night = { "夜深了，早点睡", "还不睡吗？", "（困了）" };
        private static readonly string[] Late = { "这么晚还不睡？", "陪你熬一会儿", "眼睛要坏了" };

        private static string _last = "";

        private static string[] Pool(string kind, PetState state, int hour)
        {
            switch (kind)
            {
                case "pet":
                    if (state.Mood < 35) return Low;
                    if (state.Affinity >= 60) return High;
                    return Pet;
                case "annoyed": return Annoyed;
                case "grumpy": return Grumpy;
                case "fed": return Fed;
                case "full": return Full;
                case "wake": return Wake;
                case "idle":
                    if (hour >= 5 && hour < 11) return Morning;
                    if (hour >= 23 || hour < 5) return Late;
                    if (hour >= 20) return Night;
                    return Idle;
                default: return Idle;
            }
        }

        public static string Pick(string kind, PetState state)
        {
            var pool = Pool(kind, state, DateTime.Now.Hour);
            string line = pool[Random.Next(pool.Length)];
            if (pool.Length > 1 && line == _last) line = pool[(Array.IndexOf(pool, line) + 1) % pool.Length];
            _last = line;
            return line;
        }

        public static readonly Random Random = new Random();
    }
}
