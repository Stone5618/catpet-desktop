using System;
using System.IO;
using System.Threading;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using CatPet.Core;
using CatPet.UI;

namespace CatPet
{
    internal static class Program
    {
        [DllImport("winmm.dll")] private static extern uint timeBeginPeriod(uint ms);
        [DllImport("winmm.dll")] private static extern uint timeEndPeriod(uint ms);

        private static string _assets;
        private static PetWindow _window;
        private static PetState _state;
        private static PanelForm _panel;
        private static System.Windows.Forms.Timer _guideTimer;

        [STAThread]
        private static int Main(string[] args)
        {
            if (Array.IndexOf(args, "--selftest") >= 0)
            {
                return SelfTest.Run();
            }

            bool createdNew;
            using (var mutex = new Mutex(true, "CatPet-Native-SingleInstance", out createdNew))
            {
                if (!createdNew) return 0;

                timeBeginPeriod(1); // 1ms 定时器精度：渲染循环靠它才能跑到 60fps
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                _assets = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "assets");
                Audio.Init(Path.Combine(_assets, "sounds"));

                _state = Store.Load();
                _state.Settle(PetState.Now);
                Audio.Muted = _state.Muted;

                _window = new PetWindow(_state, _assets);
                _window.Petting += OnPetting;
                _window.Feeding += OnFeeding;
                _window.OpenPanelRequested += OpenPanel;
                _window.ExitRequested += () => { _window.Close(); Application.Exit(); };

                if (!_state.FirstRunDone) StartGuide();

                Application.Run(_window);
            }

            return 0;
        }

        /// <summary>首次启动的两句引导，说完就不再出现。</summary>
        private static void StartGuide()
        {
            int step = 0;
            _guideTimer = new System.Windows.Forms.Timer { Interval = 4000 };
            _guideTimer.Tick += (s, e) =>
            {
                if (step == 0)
                {
                    _window.Say("双击我可以打开面板", 3200);
                    step = 1;
                }
                else if (step == 1)
                {
                    _window.Say("右键有喂小鱼干哦", 3200);
                    step = 2;
                }
                else
                {
                    _guideTimer.Stop();
                    _guideTimer.Dispose();
                    _guideTimer = null;
                    _state.FirstRunDone = true;
                    Store.Save(_state);
                }
            };
            _guideTimer.Start();
        }

        private static void OpenPanel()
        {
            Store.Log("OpenPanel 进入");
            try
            {
                if (_panel == null || _panel.IsDisposed)
                {
                    _panel = new PanelForm(_window, _state);
                    _panel.Show();
                    Store.Log("OpenPanel 新面板已 Show");
                }
                else
                {
                    _panel.RefreshUi();
                    _panel.Show();
                    _panel.Activate();
                    Store.Log("OpenPanel 已有面板激活");
                }
            }
            catch (Exception ex)
            {
                Store.Log("OpenPanel 异常: " + ex);
            }
        }

        private static void OnPetting(PetEvent _)
        {
            long now = PetState.Now;
            var ev = _state.Pet(now);

            switch (ev)
            {
                case PetEvent.Annoyed:
                    _window.SetMode(PetMode.Annoyed);
                    _window.Say(Lines.Pick("annoyed", _state));
                    Audio.Play("hiss.wav");
                    break;
                case PetEvent.Grumpy:
                    _window.Say(Lines.Pick("grumpy", _state));
                    break;
                case PetEvent.Happy:
                    _window.Wake();
                    _window.Say(Lines.Pick("pet", _state));
                    _window.AddHeart();
                    _window.Hop();
                    Audio.Play(Lines.Random.Next(2) == 0 ? "purr.wav" : "meow.wav");
                    break;
            }

            Store.Save(_state);
            _panel?.RefreshUi();
        }

        private static void OnFeeding()
        {
            long now = PetState.Now;
            var ev = _state.Feed(now);
            if (ev == PetEvent.Fed)
            {
                _window.Say(Lines.Pick("fed", _state));
                _window.AddFish();
                _window.Hop();
                Audio.Play("eat.wav");
            }
            else
            {
                _window.Say(Lines.Pick("full", _state));
            }
            Store.Save(_state);
            _panel?.RefreshUi();
        }
    }
}
