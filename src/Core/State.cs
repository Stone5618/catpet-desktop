using System;
using System.IO;
using System.Web.Script.Serialization;

namespace CatPet.Core
{
    public enum PetEvent { Happy, Grumpy, Annoyed, Fed, Full, None, Woken, TailGrumpy }
    /// <summary>猫身的触摸分区：头 / 身体 / 尾巴。分区决定不同的摸头反应与数值。</summary>
    public enum PetZone { Head, Body, Tail }

    /// <summary>养成状态 + 用户设置，全部持久化到 state.json。</summary>
    public class PetState
    {
        public const int MaxMood = 100;
        public const int MinMood = 5;
        /// <summary>自然衰减的地板：在线空闲与离线结算一致，心情不会因挂机低于此值。</summary>
        public const int MoodFloor = 20;
        public const int AnnoyWindowMs = 8000;
        public const int AnnoyThreshold = 5;
        public const int AnnoyDurationMs = 30000;
        // 亲密度疏远：离线满 2 小时开始掉，每满 1 小时 -1，单次结算封顶 -10；
        // 在线空闲同理每 60 分钟 -1。让"养成"有涨有跌、可降级。
        public const int AffinityOfflineGraceMs = 2 * 60 * 60 * 1000;
        public const int AffinityDecayPerHour = 1;
        public const int AffinityOfflineCap = 10;
        public const long AffinityIdleDecayMs = 60 * 60 * 1000;

        public int Version = 1;
        public int Affinity;
        public int Mood = 70;
        public long LastSeen;
        public long LastPetAt;
        public long LastFedAt;
        public long AnnoyedUntil;
        public int PetStreak;
        public long CreatedAt;
        public string Day = "";

        public int TodayPetted;
        public int TodayFed;

        // 窗口与偏好
        public int WindowX = int.MinValue;
        public int WindowY = int.MinValue;
        public double Scale = 1.0;
        public bool Muted;
        public string Skin = "hijiki";
        public bool Pinned = true;
        public bool AutoPassthrough = true;
        public bool FirstRunDone;

        private static readonly string[] LevelTitles = { "陌生猫", "眼熟的猫", "朋友", "粘人精", "家人" };
        private static readonly int[] LevelMins = { 0, 10, 30, 60, 100 };

        public static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        public static string DayKey(long ms)
        {
            return DateTimeOffset.FromUnixTimeMilliseconds(ms).ToLocalTime().ToString("yyyy-MM-dd");
        }

        /// <summary>统一的"夜间"定义（23:00–6:00）：入睡阈值与台词库共用，避免各处界线漂移。</summary>
        public static bool IsNight(int hour) => hour >= 23 || hour < 6;

        public static PetState Create(long now)
        {
            return new PetState
            {
                Affinity = 0,
                Mood = 70,
                LastSeen = now,
                CreatedAt = now,
                Day = DayKey(now)
            };
        }

        public string LevelTitle
        {
            get
            {
                int idx = 0;
                for (int i = 0; i < LevelMins.Length; i++) if (Affinity >= LevelMins[i]) idx = i;
                return LevelTitles[idx];
            }
        }

        public int LevelIndex
        {
            get
            {
                int idx = 0;
                for (int i = 0; i < LevelMins.Length; i++) if (Affinity >= LevelMins[i]) idx = i;
                return idx;
            }
        }

        public int NextLevelAt
        {
            get
            {
                int idx = LevelIndex;
                return idx + 1 < LevelMins.Length ? LevelMins[idx + 1] : -1;
            }
        }

        public double LevelProgress
        {
            get
            {
                int idx = LevelIndex;
                if (idx + 1 >= LevelMins.Length) return 1.0;
                int start = LevelMins[idx], end = LevelMins[idx + 1];
                double p = (double)(Affinity - start) / (end - start);
                return Math.Max(0, Math.Min(1, p));
            }
        }

        public void RefreshDay(long now)
        {
            string key = DayKey(now);
            if (Day == key) return;
            Day = key;
            TodayPetted = 0;
            TodayFed = 0;
        }

        /// <summary>启动结算：离开越久心情掉得越多（最多 25 点）；离开够久亲密度也会疏远（可降级）。</summary>
        public void Settle(long now)
        {
            RefreshDay(now);
            long away = Math.Max(0, now - LastSeen);
            long minutes = away / 60000;
            if (minutes >= 10)
            {
                int loss = (int)Math.Min(25, minutes / 10);
                Mood = Clamp(Mood - loss, MoodFloor, MaxMood);
            }
            // 亲密度疏远：2 小时宽限期后每满 1 小时 -1，封顶 -10
            if (away >= AffinityOfflineGraceMs)
            {
                int hours = (int)((away - AffinityOfflineGraceMs) / 3600000);
                int decay = Math.Min(AffinityOfflineCap, hours * AffinityDecayPerHour);
                if (decay > 0) Affinity = Math.Max(0, Affinity - decay);
            }
            LastSeen = now;
            PetStreak = 0;
        }

        /// <summary>在线空闲亲密度疏远：每 60 分钟 -1，地板 0（可降级）。</summary>
        public void IdleAffinityDecay(long idleMs)
        {
            int steps = (int)(idleMs / AffinityIdleDecayMs);
            if (steps <= 0) return;
            Affinity = Math.Max(0, Affinity - steps);
        }

        /// <summary>空闲衰减：每 20 分钟 1 点，地板 20。</summary>
        public void IdleDecay(long idleMs)
        {
            int steps = (int)(idleMs / (20 * 60 * 1000));
            if (steps <= 0) return;
            Mood = Clamp(Mood - steps, MoodFloor, MaxMood);
        }

        public PetEvent Pet(long now) => Pet(now, PetZone.Head);

        /// <summary>按触摸分区摸猫：头=舒服、身体=一般、尾巴=概率惹怒。连点炸毛逻辑不变。</summary>
        public PetEvent Pet(long now, PetZone zone)
        {
            TodayPetted++;
            long previousPetAt = LastPetAt;
            LastPetAt = now;

            if (now < AnnoyedUntil) return PetEvent.Grumpy;

            if (previousPetAt == 0 || now - previousPetAt > AnnoyWindowMs) PetStreak = 0;
            PetStreak++;

            if (PetStreak >= AnnoyThreshold)
            {
                PetStreak = 0;
                AnnoyedUntil = now + AnnoyDurationMs;
                Mood = Clamp(Mood - 3, MinMood, MaxMood);
                return PetEvent.Annoyed;
            }

            // 分区数值：头 +2 心情 +2 亲密，身体 +1 心情 +1 亲密，尾巴 7% 惹怒否则 +0/+1
            switch (zone)
            {
                case PetZone.Head:
                    Mood = Clamp(Mood + 2, MinMood, MaxMood);
                    Affinity = Math.Max(0, Affinity + 2);
                    return PetEvent.Happy;
                case PetZone.Body:
                    Mood = Clamp(Mood + 1, MinMood, MaxMood);
                    Affinity = Math.Max(0, Affinity + 1);
                    return PetEvent.Happy;
                default: // Tail
                    if (Lines.Random.Next(100) < 7)
                    {
                        Mood = Clamp(Mood - 3, MinMood, MaxMood);
                        Affinity = Math.Max(0, Affinity - 2);
                        return PetEvent.TailGrumpy;
                    }
                    Mood = Clamp(Mood + 1, MinMood, MaxMood);
                    Affinity = Math.Max(0, Affinity + 1);
                    return PetEvent.Happy;
            }
        }

        public PetEvent Feed(long now)
        {
            if (Mood >= 92) return PetEvent.Full;
            Mood = Clamp(Mood + 14, MinMood, MaxMood);
            Affinity = Math.Max(0, Affinity + 3);
            LastFedAt = now;
            TodayFed++;
            return PetEvent.Fed;
        }

        public bool IsAnnoyed(long now) => now < AnnoyedUntil;

        public static int Clamp(int v, int lo, int hi) => v < lo ? lo : (v > hi ? hi : v);
    }

    /// <summary>原子写入的存档读写。</summary>
    public static class Store
    {
        public static string Dir
        {
            get
            {
                string dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CatPet");
                Directory.CreateDirectory(dir);
                return dir;
            }
        }

        public static string FilePath => Path.Combine(Dir, "state.json");
        public static string LogPath => Path.Combine(Dir, "catpet.log");

        public static PetState Load()
        {
            try
            {
                if (!File.Exists(FilePath)) return PetState.Create(PetState.Now);
                string json = File.ReadAllText(FilePath);
                var ser = new JavaScriptSerializer();
                var state = ser.Deserialize<PetState>(json);
                if (state == null) return PetState.Create(PetState.Now);
                return Normalize(state);
            }
            catch (Exception ex)
            {
                Log("读取存档失败，使用默认值: " + ex.Message);
                return PetState.Create(PetState.Now);
            }
        }

        public static void Save(PetState state)
        {
            try
            {
                state.LastSeen = PetState.Now;
                var ser = new JavaScriptSerializer();
                string json = ser.Serialize(state);
                string tmp = FilePath + ".tmp";
                File.WriteAllText(tmp, json);
                if (File.Exists(FilePath)) File.Replace(tmp, FilePath, null);
                else File.Move(tmp, FilePath);
            }
            catch (Exception ex)
            {
                Log("保存失败: " + ex.Message);
            }
        }

        private static PetState Normalize(PetState s)
        {
            s.Affinity = Math.Max(0, s.Affinity);
            s.Mood = PetState.Clamp(s.Mood, PetState.MinMood, PetState.MaxMood);
            if (string.IsNullOrEmpty(s.Day)) s.Day = PetState.DayKey(PetState.Now);
            if (s.Scale < 0.5 || s.Scale > 2.0) s.Scale = 1.0;
            if (string.IsNullOrEmpty(s.Skin)) s.Skin = "hijiki";
            if (s.TodayPetted < 0) s.TodayPetted = 0;
            if (s.TodayFed < 0) s.TodayFed = 0;
            return s;
        }

        public static void Log(string message)
        {
            try
            {
                File.AppendAllText(LogPath,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message + Environment.NewLine);
            }
            catch { /* 日志失败不影响主流程 */ }
        }
    }
}
