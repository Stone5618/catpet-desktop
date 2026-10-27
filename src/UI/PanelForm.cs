using System;
using System.Drawing;
using System.Windows.Forms;
using CatPet.Core;

namespace CatPet.UI
{
    /// <summary>设置与养成面板：原生窗口，不依赖浏览器。</summary>
    internal sealed class PanelForm : Form
    {
        private readonly PetWindow _pet;
        private readonly PetState _state;

        private readonly Label _level = new Label();
        private readonly Label _affinity = new Label();
        private readonly ProgressBar _levelBar = new ProgressBar();
        private readonly Label _moodText = new Label();
        private readonly ProgressBar _moodBar = new ProgressBar();
        private readonly Label _today = new Label();
        private readonly CheckBox _mute = new CheckBox();
        private readonly CheckBox _startup = new CheckBox();
        private readonly ComboBox _scale = new ComboBox();

        public PanelForm(PetWindow pet, PetState state)
        {
            _pet = pet;
            _state = state;

            Text = "猫猫档案";
            TopMost = true;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.Manual;
            ClientSize = new Size(300, 372);
            BackColor = Color.FromArgb(252, 252, 253);
            Font = new Font("Microsoft YaHei", 9f);

            _level.SetBounds(16, 14, 200, 26);
            _level.Font = new Font("Microsoft YaHei", 14f, FontStyle.Bold);
            _level.ForeColor = Color.FromArgb(226, 104, 138);
            _level.Text = "陌生猫";

            _affinity.SetBounds(16, 42, 268, 18);
            _affinity.ForeColor = Color.Gray;

            _levelBar.SetBounds(16, 64, 268, 8);
            _levelBar.Style = ProgressBarStyle.Continuous;

            _moodText.SetBounds(16, 82, 268, 18);
            _moodText.ForeColor = Color.Gray;

            _moodBar.SetBounds(16, 104, 268, 8);

            _today.SetBounds(16, 122, 268, 18);
            _today.ForeColor = Color.Gray;

            _mute.Text = "静音";
            _mute.SetBounds(16, 150, 80, 22);

            _startup.Text = "开机自启";
            _startup.SetBounds(104, 150, 100, 22);

            var scaleLabel = new Label { Text = "大小", ForeColor = Color.Gray };
            scaleLabel.SetBounds(16, 182, 40, 22);
            _scale.DropDownStyle = ComboBoxStyle.DropDownList;
            _scale.SetBounds(58, 179, 90, 24);
            _scale.Items.AddRange(new object[] { "75%", "100%", "125%", "150%" });

            var skinBtn = new Button { Text = "切换皮肤" };
            skinBtn.SetBounds(160, 178, 124, 28);
            skinBtn.Click += (s, e) =>
            {
                _pet.SwitchSkin(_state.Skin == "hijiki" ? "tororo" : "hijiki");
                RefreshUi();
            };

            var petBtn = new Button { Text = "摸摸头" };
            petBtn.SetBounds(16, 218, 128, 32);
            petBtn.Click += (s, e) => _pet.PetFromPanel();

            var feedBtn = new Button { Text = "喂小鱼干" };
            feedBtn.SetBounds(156, 218, 128, 32);
            feedBtn.Click += (s, e) => _pet.FeedFromPanel();

            var hideBtn = new Button { Text = "藏起来" };
            hideBtn.SetBounds(16, 260, 128, 30);
            hideBtn.Click += (s, e) => _pet.HidePet();

            var quitBtn = new Button { Text = "退出" };
            quitBtn.SetBounds(156, 260, 128, 30);
            quitBtn.Click += (s, e) => _pet.ExitApp();

            var tip = new Label
            {
                Text = "左键摸头 · 双击面板 · 右键更多 · 拖拽可换位置",
                ForeColor = Color.Silver,
                Font = new Font("Microsoft YaHei", 8f)
            };
            tip.SetBounds(16, 306, 268, 40);

            Controls.AddRange(new Control[]
            {
                _level, _affinity, _levelBar, _moodText, _moodBar, _today,
                _mute, _startup, scaleLabel, _scale, skinBtn,
                petBtn, feedBtn, hideBtn, quitBtn, tip
            });

            _mute.Checked = _state.Muted;
            _mute.CheckedChanged += (s, e) =>
            {
                _state.Muted = _mute.Checked;
                Audio.Muted = _state.Muted;
                Store.Save(_state);
                if (!_state.Muted) Audio.Play("meow2.wav");
            };

            _startup.Checked = Autostart.IsEnabled();
            _startup.CheckedChanged += (s, e) =>
            {
                Autostart.Set(_startup.Checked);
                _startup.Checked = Autostart.IsEnabled();
            };

            int idx = _state.Scale <= 0.8 ? 0 : _state.Scale <= 1.05 ? 1 : _state.Scale <= 1.3 ? 2 : 3;
            _scale.SelectedIndex = idx;
            _scale.SelectedIndexChanged += (s, e) =>
            {
                double[] values = { 0.75, 1.0, 1.25, 1.5 };
                _pet.SetScale(values[_scale.SelectedIndex]);
            };

            RefreshUi();
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            // 贴到猫的旁边
            var wa = Screen.FromPoint(new Point(_pet.Left, _pet.Top)).WorkingArea;
            int x = _pet.Left - Width - 12;
            if (x < wa.Left) x = _pet.Left + _pet.Width + 12;
            x = Math.Max(wa.Left, Math.Min(wa.Right - Width, x));
            int y = Math.Max(wa.Top, Math.Min(wa.Bottom - Height, _pet.Top));
            Location = new Point(x, y);
        }

        public void RefreshUi()
        {
            _level.Text = _state.LevelTitle;
            _affinity.Text = _state.NextLevelAt < 0
                ? "亲密度 " + _state.Affinity + " · 满级"
                : "亲密度 " + _state.Affinity + " / " + _state.NextLevelAt;
            _levelBar.Value = Math.Max(0, Math.Min(100, (int)(_state.LevelProgress * 100)));
            _moodText.Text = "心情 " + _state.Mood + " / 100";
            _moodBar.Value = Math.Max(0, Math.Min(100, _state.Mood));
            _today.Text = "今天被摸 " + _state.TodayPetted + " 次 · 吃鱼 " + _state.TodayFed + " 次";
            _mute.Checked = _state.Muted;
        }
    }
}
