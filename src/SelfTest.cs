using System;
using System.Diagnostics;
using System.IO;
using CatPet.Core;

namespace CatPet
{
    internal static class SelfTest
    {
        private static int _fail;

        private static void Check(string name, bool ok, string detail = "")
        {
            Console.WriteLine((ok ? "PASS  " : "FAIL  ") + name + (detail.Length > 0 ? "  [" + detail + "]" : ""));
            if (!ok) _fail++;
        }

        public static int Run()
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string assets = Path.Combine(root, "assets", "skins");
            if (!Directory.Exists(assets)) assets = Path.Combine(Directory.GetCurrentDirectory(), "assets", "skins");

            foreach (var skin in new[] { "hijiki", "tororo" })
            {
                string file = Path.Combine(assets, skin, "frames.cpf");
                if (!File.Exists(file))
                {
                    Check("帧集存在: " + skin, false, file);
                    continue;
                }
                try
                {
                    using (var set = FrameSet.Load(file))
                    {
                        Check("帧集加载: " + skin, set.Width > 0 && set.FrameCount > 0,
                            $"{set.Width}x{set.Height} {set.FrameCount}帧 {set.Fps}fps");
                        var sw = Stopwatch.StartNew();
                        set.Reset();
                        int opaque = 0;
                        for (int i = 0; i < set.FrameCount; i++)
                        {
                            var buf = set.Next();
                            if (i == 0)
                            {
                                for (int p = 3; p < buf.Length; p += 4) if (buf[p] > 8) opaque++;
                            }
                        }
                        sw.Stop();
                        Check("帧集解码全循环: " + skin, opaque > 1000,
                            $"不透明像素 {opaque}，解码 {set.FrameCount} 帧耗时 {sw.ElapsedMilliseconds}ms");
                        double perFrame = sw.Elapsed.TotalMilliseconds / set.FrameCount;
                        Check("单帧解码成本 < 2ms: " + skin, perFrame < 2.0, perFrame.ToString("0.00") + "ms");
                    }
                }
                catch (Exception ex)
                {
                    Check("帧集异常: " + skin, false, ex.Message);
                }
            }

            long now = 1700000000000;
            var s = PetState.Create(now);
            Check("初始心情/亲密度", s.Mood == 70 && s.Affinity == 0);

            var e1 = s.Pet(now + 100);
            Check("第一次摸: 开心 + 亲密度", e1 == PetEvent.Happy && s.Affinity == 1, e1.ToString());

            for (int i = 0; i < 4; i++) s.Pet(now + 200 + i * 100);
            Check("连摸 5 次炸毛", s.IsAnnoyed(now + 1000), s.PetStreak.ToString());

            var grumpy = s.Pet(now + 1500);
            Check("生气时不加亲密度", grumpy == PetEvent.Grumpy);

            var s2 = PetState.Create(now);
            s2.Mood = 95;
            Check("吃饱拒绝", s2.Feed(now) == PetEvent.Full);

            var s3 = PetState.Create(now);
            s3.Mood = 60;
            Check("喂食 +14 心情 +3 亲密度", s3.Feed(now) == PetEvent.Fed && s3.Mood == 74 && s3.Affinity == 3);

            var s4 = PetState.Create(now);
            s4.Affinity = 35;
            Check("等级: 朋友", s4.LevelTitle == "朋友", s4.LevelTitle);
            s4.Affinity = 100;
            Check("等级: 家人 + 满级进度", s4.LevelTitle == "家人" && s4.LevelProgress >= 1.0);

            var s5 = PetState.Create(now);
            s5.Mood = 90;
            s5.LastSeen = now;
            s5.Settle(now + 30 * 60 * 1000);
            Check("离线 30 分钟掉 3 点心情", s5.Mood == 87, s5.Mood.ToString());

            var s6 = PetState.Create(now);
            s6.Mood = 90;
            s6.LastSeen = now;
            s6.Settle(now + 10 * 60 * 60 * 1000);
            Check("离线 10 小时最多掉 25", s6.Mood == 65, s6.Mood.ToString());

            var s7 = PetState.Create(now);
            s7.TodayPetted = 9;
            s7.RefreshDay(now + 24 * 60 * 60 * 1000);
            Check("跨天重置今日计数", s7.TodayPetted == 0);

            var s8 = PetState.Create(now);
            s8.Mood = 30;
            s8.IdleDecay(20 * 60 * 1000);
            Check("空闲 20 分钟掉 1 点", s8.Mood == 29, s8.Mood.ToString());

            Console.WriteLine();
            Console.WriteLine(_fail == 0 ? "SELFTEST PASS" : $"SELFTEST FAIL ({_fail})");
            return _fail == 0 ? 0 : 1;
        }
    }
}
