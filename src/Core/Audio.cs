using System;
using System.IO;
using System.Runtime.InteropServices;

namespace CatPet.Core
{
    /// <summary>声音：用 winmm 的 PlaySound 播 WAV，异步、无第三方依赖。</summary>
    public static class Audio
    {
        [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
        private static extern bool PlaySound(string sound, IntPtr module, uint flags);

        private const uint SndAsync = 0x0001;
        private const uint SndNoDefault = 0x0002;
        private const uint SndFilename = 0x20000;

        private static string _dir = "";
        public static bool Muted { get; set; }

        public static void Init(string dir)
        {
            _dir = dir;
        }

        public static bool Exists(string name)
        {
            return _dir.Length > 0 && File.Exists(Path.Combine(_dir, name));
        }

        public static void Play(string name)
        {
            if (Muted) return;
            try
            {
                string path = Path.Combine(_dir, name);
                if (!File.Exists(path)) return;
                PlaySound(path, IntPtr.Zero, SndFilename | SndAsync | SndNoDefault);
            }
            catch (Exception ex)
            {
                Store.Log("播放失败: " + ex.Message);
            }
        }

        public static void Stop()
        {
            try { PlaySound(null, IntPtr.Zero, 0); } catch { }
        }
    }
}
