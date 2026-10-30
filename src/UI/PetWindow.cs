using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using CatPet.Core;

namespace CatPet.UI
{
    internal enum PetMode { Idle, Sleeping, Annoyed }

#pragma warning disable 0649
    internal sealed class SkinMeta
    {
        public string skin;
        public int width;
        public int height;
        public CropRect crop;
        public int fps;
        public int frames;
    }

    internal sealed class CropRect
    {
        public int x, y, width, height;
    }

    /// <summary>原生分层窗口：逐像素透明、置顶、穿透由 Windows 按 alpha 命中。</summary>
    internal sealed class PetWindow : Form
    {
        public const int BaseW = 320;
        public const int BaseH = 380;
        // 猫头顶留给气泡的高度（逻辑像素，随缩放一起放大）
        private const int TopSpace = 44;

        private const int WM_TRAY = 0x8001;
        private const int WM_COMMAND = 0x0111;

        [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hWnd);
        [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr hdc);
        [DllImport("gdi32.dll")] private static extern IntPtr CreateDIBSection(IntPtr hdc, ref BitmapInfo bmi, uint usage, out IntPtr bits, IntPtr section, uint offset);
        [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
        [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
        [DllImport("user32.dll")] private static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref Point32 pptDst, ref Size32 psize, IntPtr hdcSrc, ref Point32 pptSrc, int crKey, ref BlendFunction pblend, int flags);
        [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out Rect32 rect);
        [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LastInputInfo plii);
        [DllImport("user32.dll")] private static extern IntPtr LoadImage(IntPtr hinst, string name, uint type, int cx, int cy, uint load);
        [DllImport("user32.dll")] private static extern IntPtr CreatePopupMenu();
        [DllImport("user32.dll")] private static extern bool AppendMenu(IntPtr menu, uint flags, IntPtr id, string text);
        [DllImport("user32.dll")] private static extern int TrackPopupMenu(IntPtr menu, uint flags, int x, int y, int reserved, IntPtr hwnd, IntPtr rect);
        [DllImport("user32.dll")] private static extern bool DestroyMenu(IntPtr menu);
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern bool Shell_NotifyIcon(uint message, ref NotifyIconData data);
        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)] private struct Point32 { public int X, Y; }
        [StructLayout(LayoutKind.Sequential)] private struct Size32 { public int CX, CY; }
        [StructLayout(LayoutKind.Sequential)] private struct Rect32 { public int L, T, R, B; }
        [StructLayout(LayoutKind.Sequential)] private struct LastInputInfo { public uint cbSize; public uint dwTime; }
        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        private struct BlendFunction { public byte BlendOp, BlendFlags, SourceConstantAlpha, AlphaFormat; }
        [StructLayout(LayoutKind.Sequential)]
        private struct BitmapInfoHeader
        {
            public uint biSize; public int biWidth, biHeight;
            public ushort biPlanes, biBitCount; public uint biCompression, biSizeImage;
            public int biXPelsPerMeter, biYPelsPerMeter; public uint biClrUsed, biClrImportant;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct BitmapInfo { public BitmapInfoHeader bmiHeader; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct NotifyIconData
        {
            public uint cbSize; public IntPtr hWnd; public uint uID; public uint uFlags;
            public uint uCallbackMessage; public IntPtr hIcon;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szTip;
            public uint dwState; public uint dwStateMask;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string szInfo;
            public uint uVersion;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string szInfoTitle;
            public uint dwInfoFlags;
            public Guid guidItem;
            public IntPtr hBalloonIcon;
        }

        private readonly object _sync = new object();
        private readonly List<Heart> _hearts = new List<Heart>();
        private readonly List<Heart> _fish = new List<Heart>();

        private PetState _state;
        private FrameSet _frames;
        private byte[] _decoded;
        private int _decodedStride;
        private int[] _rectX, _rectY, _rectW, _rectH;
        private int _lastSrcX, _lastSrcY, _lastSrcW, _lastSrcH;
        private bool _fullScaledDraw = true;
        private bool _hadEffects;
        private int _decodedCount;
        private int _decodedIndex;
        private SkinMeta _meta;
        private PetMode _mode = PetMode.Idle;
        private double _scale = 1.0;
        private int _winW = BaseW, _winH = BaseH;

        // 画布
        private IntPtr _screenDc, _memDc, _dib, _oldObj, _dibBits;
        private byte[] _canvasBytes;
        private GCHandle _canvasHandle;
        private Bitmap _canvasBmp;
        private Graphics _canvasGfx;
        private byte[] _scaleSrcBytes;
        private GCHandle _scaleSrcHandle;
        private Bitmap _scaleSrcBmp;
        private IntPtr _framePtr;
        private GCHandle _frameHandle;

        // 覆盖层缓存（睡眠 Zzz / 炸毛图标）：随缩放档重建，避免每帧分配 GDI+ 对象
        private Font _sleepFont;
        private SolidBrush _sleepBrush;
        private SolidBrush _annoyBrush;

        // 气泡缓存
        private Bitmap _bubbleCache;
        private string _bubbleCacheText;
        private string _bubbleText = "";
        private long _bubbleUntil;

        private Thread _renderThread;
        private volatile bool _alive = true;
        private bool _visible = true;
        private long _lastInteraction;

        // 拖拽/抛掷
        private bool _dragging;
        private bool _moved;
        private long _dragStart;
        private Point _dragOffset;
        private Point _downCursor;
        private readonly List<Sample> _samples = new List<Sample>();
        private System.Windows.Forms.Timer _physicsTimer;
        private double _px, _py, _vx, _vy;

        private long _lastClickAt;
        private System.Windows.Forms.Timer _behaviorTimer;

        // 托盘
        private IntPtr _trayIcon;
        private bool _trayAdded;

        private sealed class Heart { public float X, Y; public long Start; public float Vx; }
        private struct Sample { public long T; public int X, Y; }

        public PetWindow(PetState state, string assetsDir)
        {
            _state = state;
            _scale = state.Scale;
            AssetsDir = assetsDir;

            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = state.Pinned;
            StartPosition = FormStartPosition.Manual;
            AutoScaleMode = AutoScaleMode.None;
            BackColor = Color.Black;
            SetStyle(ControlStyles.Opaque, true);
            SetStyle(ControlStyles.UserPaint, true);

            LoadSkin(state.Skin);
            ApplyScale(state.Scale, true);
            PositionWindow(state.WindowX, state.WindowY);

            _lastInteraction = Environment.TickCount;
        }

        public string AssetsDir { get; }
        public event Action<PetEvent> Petting;
        public event Action Feeding;
        public event Action OpenPanelRequested;
        public event Action ExitRequested;
        public event Action SettingsChanged;

        protected override bool ShowWithoutActivation => true;

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            LoadTrayIcon();
            StartRenderLoop();
            StartBehavior();
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= 0x80000 | 0x8 | 0x80 | 0x08000000; // LAYERED | TOPMOST | TOOLWINDOW | NOACTIVATE
                return cp;
            }
        }

        protected override void OnPaintBackground(PaintEventArgs e) { }
        protected override void OnPaint(PaintEventArgs e) { }

        // ---------------- 皮肤 / 尺寸 ----------------

        private void LoadSkin(string skin)
        {
            string dir = Path.Combine(AssetsDir, "skins", skin);
            string cpf = Path.Combine(dir, "frames.cpf");
            string metaPath = Path.Combine(dir, "meta.json");
            if (!File.Exists(cpf))
            {
                Store.Log("缺少皮肤: " + cpf);
                return;
            }

            var frames = FrameSet.Load(cpf);
            var ser = new JavaScriptSerializer();
            var meta = File.Exists(metaPath)
                ? ser.Deserialize<SkinMeta>(File.ReadAllText(metaPath))
                : new SkinMeta { crop = new CropRect { x = 0, y = 0, width = frames.Width, height = frames.Height } };

            // 启动时一次性解码整段循环：60fps 播放时不再有解压开销
            int stride = frames.Width * frames.Height * 4;
            var decoded = new byte[(long)frames.FrameCount * stride];
            var rx = new int[frames.FrameCount];
            var ry = new int[frames.FrameCount];
            var rw = new int[frames.FrameCount];
            var rh = new int[frames.FrameCount];
            frames.Reset();
            for (int i = 0; i < frames.FrameCount; i++)
            {
                var buf = frames.Next();
                Buffer.BlockCopy(buf, 0, decoded, i * stride, stride);
                rx[i] = frames.LastRectX; ry[i] = frames.LastRectY;
                rw[i] = frames.LastRectW; rh[i] = frames.LastRectH;
            }

            lock (_sync)
            {
                _frames?.Dispose();
                _frames = frames;
                _meta = meta;
                _decoded = decoded;
                _decodedStride = stride;
                _decodedCount = frames.FrameCount;
                _decodedIndex = 0;
                _rectX = rx; _rectY = ry; _rectW = rw; _rectH = rh;
                _fullScaledDraw = true;
                if (_frameHandle.IsAllocated) _frameHandle.Free();
                _frameHandle = GCHandle.Alloc(decoded, GCHandleType.Pinned);
                _framePtr = _frameHandle.AddrOfPinnedObject();

                // 缩放渲染用的常驻缓冲：每帧只做一次拷贝，绝不每帧 new Bitmap
                if (_scaleSrcHandle.IsAllocated) _scaleSrcHandle.Free();
                _scaleSrcBmp?.Dispose();
                _scaleSrcBytes = new byte[stride];
                _scaleSrcHandle = GCHandle.Alloc(_scaleSrcBytes, GCHandleType.Pinned);
                _scaleSrcBmp = new Bitmap(_frames.Width, _frames.Height, _frames.Width * 4,
                    PixelFormat.Format32bppPArgb, _scaleSrcHandle.AddrOfPinnedObject());

                frames = null;
            }
            _state.Skin = skin;
        }

        public void SwitchSkin(string skin)
        {
            if (skin == _state.Skin) return;
            LoadSkin(skin);
            // 两套皮肤素材尺寸不同（241x319 / 246x321），换皮后必须按新素材重算窗口
            if (Handle != IntPtr.Zero) ApplyScale(_state.Scale, true);
            Store.Save(_state);
            SettingsChanged?.Invoke();
        }

        private void ApplyScale(double scale, bool rebuild)
        {
            _scale = Math.Max(0.5, Math.Min(2.0, scale));
            // 窗口贴着猫本体：宽度=素材宽，高度=气泡带+素材高
            int contentW = _meta != null ? _meta.crop.width : BaseW;
            int contentH = _meta != null ? _meta.crop.height : BaseH;
            int w = (int)Math.Round(contentW * _scale);
            int h = (int)Math.Round(TopSpace * _scale) + (int)Math.Round(contentH * _scale);
            if (w == _winW && h == _winH && !rebuild) return;
            lock (_sync)
            {
                // 尺寸和画布必须在同一把锁里切换：
                // 否则渲染线程会拿新尺寸去写旧数组，偶发"索引超出数组界限"
                _winW = w;
                _winH = h;
                RebuildCanvas();
                // 气泡位图是按旧字号缓存的，缩放变了必须作废重排
                _bubbleCache?.Dispose();
                _bubbleCache = null;
                _bubbleCacheText = null;
                _fullScaledDraw = true;
            }
            SetWindowPos(Handle, IntPtr.Zero, Left, Top, w, h, 0x0014 /*NOZORDER|NOACTIVATE*/);
            // 尺寸变大后可能超出工作区（贴边时尤其明显），必须钳回来
            if (IsHandleCreated) ClampToWorkArea();
            _state.Scale = _scale;
        }

        public void SetScale(double scale)
        {
            ApplyScale(scale, true);
            Store.Save(_state);
            SettingsChanged?.Invoke();
        }

        private void RebuildCanvas()
        {
            _canvasGfx?.Dispose();
            if (_canvasHandle.IsAllocated) _canvasHandle.Free();
            if (_canvasBmp != null) _canvasBmp.Dispose();
            if (_dib != IntPtr.Zero) { SelectObject(_memDc, _oldObj); DeleteObject(_dib); _dib = IntPtr.Zero; }

            _canvasBytes = new byte[_winW * _winH * 4];
            _canvasHandle = GCHandle.Alloc(_canvasBytes, GCHandleType.Pinned);
            _canvasBmp = new Bitmap(_winW, _winH, _winW * 4, PixelFormat.Format32bppPArgb, _canvasHandle.AddrOfPinnedObject());
            _canvasGfx = Graphics.FromImage(_canvasBmp);
            _canvasGfx.SmoothingMode = SmoothingMode.AntiAlias;
            _canvasGfx.InterpolationMode = InterpolationMode.HighQualityBilinear;
            _canvasGfx.PixelOffsetMode = PixelOffsetMode.HighQuality;

            if (_screenDc == IntPtr.Zero) _screenDc = GetDC(IntPtr.Zero);
            if (_memDc == IntPtr.Zero) _memDc = CreateCompatibleDC(_screenDc);
            var bmi = new BitmapInfo
            {
                bmiHeader = new BitmapInfoHeader
                {
                    biSize = (uint)Marshal.SizeOf(typeof(BitmapInfoHeader)),
                    biWidth = _winW,
                    biHeight = -_winH,
                    biPlanes = 1,
                    biBitCount = 32,
                    biCompression = 0
                }
            };
            _dib = CreateDIBSection(_screenDc, ref bmi, 0, out _dibBits, IntPtr.Zero, 0);
            _oldObj = SelectObject(_memDc, _dib);

            // 覆盖层字体/画笔按旧字号缓存，缩放变了必须作废（与 _bubbleCache 同一规则）
            if (_sleepFont != null) { _sleepFont.Dispose(); _sleepFont = null; }
            if (_sleepBrush != null) { _sleepBrush.Dispose(); _sleepBrush = null; }
            if (_annoyBrush != null) { _annoyBrush.Dispose(); _annoyBrush = null; }
        }

        // ---------------- 渲染 ----------------

        private void StartRenderLoop()
        {
            if (_renderThread != null) return;
            _renderThread = new Thread(RenderLoop) { IsBackground = true, Name = "pet-render" };
            _renderThread.Start();
        }

        private void RenderLoop()
        {
            var sw = Stopwatch.StartNew();
            double next = 0;
            int frames = 0;
            long renderTicks = 0;
            double lastStat = 0;
            bool stats = Environment.GetEnvironmentVariable("CATPET_STATS") == "1";
            while (_alive)
            {
                double now = sw.Elapsed.TotalMilliseconds;
                if (now >= next)
                {
                    next = now + 1000.0 / 60.0;
                    long t0 = Stopwatch.GetTimestamp();
                    try { RenderFrame(now); frames++; } catch (Exception ex) { Store.Log("渲染异常: " + ex); }
                    renderTicks += Stopwatch.GetTimestamp() - t0;
                }
                if (stats && now - lastStat >= 1000)
                {
                    lastStat = now;
                    try
                    {
                        using (var proc = System.Diagnostics.Process.GetCurrentProcess())
                        {
                            var json = "{\"fps\":" + frames + ",\"avgMs\":" + (frames > 0 ? (renderTicks * 1000.0 / Stopwatch.Frequency / frames).ToString("0.00") : "0") + ",\"memMB\":" + (proc.WorkingSet64 / 1024 / 1024)
                                       + ",\"uptime\":" + (int)(now / 1000)
                                       + ",\"mode\":\"" + _mode + "\""
                                       + ",\"visible\":" + (_visible ? "true" : "false") + "}";
                            File.WriteAllText(Path.Combine(Store.Dir, "stats.json"), json);
                        }
                        frames = 0;
                        renderTicks = 0;
                    }
                    catch { }
                }
                Thread.Sleep(1);
            }
        }

        private void AdvanceFrame()
        {
            if (_decoded == null || _decodedCount == 0) return;
            _decodedIndex++;
            if (_decodedIndex >= _decodedCount) _decodedIndex = 0;
        }

        private void RenderFrame(double now)
        {
            if (!_visible) return;
            Point32 dst;
            Size32 size;
            lock (_sync)
            {
                if (_canvasGfx == null || _frames == null) return;

                // 帧推进
                if (Environment.GetEnvironmentVariable("CATPET_NODECODE") != "1") AdvanceFrame();

                int catX = 0;
                int catY = (int)Math.Round(TopSpace * _scale);
                int catW = (int)Math.Round(_meta.crop.width * _scale);
                int catH = (int)Math.Round(_meta.crop.height * _scale);

                // 状态覆盖层（与气泡/粒子同一时基：wall clock）
                long wall = NowMs();
                // 只有画在猫身内部的粒子（爱心/小鱼）才需要整幅重画；
                // 气泡和 Zzz 在顶部条里，每帧单独清条即可
                bool effects = HasParticles();

                if (Math.Abs(_scale - 1.0) < 0.001)
                {
                    // 1x 是整块覆盖写，只清边框即可
                    ClearOutside(catX, catY, catW, catH);
                    BlitFrame1x();
                }
                else
                {
                    // 缩放档：默认只重画脏区（速度），有粒子或需要整幅时走整幅（正确性）
                    bool full = _fullScaledDraw || _hadEffects || effects;
                    if (full)
                    {
                        DrawScaledFull(catX, catY, catW, catH);
                        _fullScaledDraw = false;
                    }
                    else
                    {
                        DrawScaledDirty(catX, catY, catW, catH);
                    }
                    _hadEffects = effects;
                }

                if (_mode == PetMode.Sleeping) DrawSleeping();
                if (_mode == PetMode.Annoyed) DrawAnnoyed(wall);

                // 爱心/小鱼
                DrawParticles(wall);

                // 气泡
                if (wall < _bubbleUntil) DrawBubble();

                // 画布 -> DIB，再整体提交
                if (_dibBits != IntPtr.Zero) Marshal.Copy(_canvasBytes, 0, _dibBits, _canvasBytes.Length);

                // 提交
                Rect32 rc; GetWindowRect(Handle, out rc);
                dst = new Point32 { X = rc.L, Y = rc.T };
                size = new Size32 { CX = _winW, CY = _winH };
                var src = new Point32 { X = 0, Y = 0 };
                var blend = new BlendFunction { BlendOp = 0, BlendFlags = 0, SourceConstantAlpha = 255, AlphaFormat = 1 };
                if (Environment.GetEnvironmentVariable("CATPET_NOPRESENT") != "1") UpdateLayeredWindow(Handle, _screenDc, ref dst, ref size, _memDc, ref src, 0, ref blend, 2);
            }
        }



        /// <summary>缩放档：整幅重画。</summary>
        private void DrawScaledFull(int catX, int catY, int catW, int catH)
        {
            if (_scaleSrcBmp == null || _decoded == null) return;
            Array.Clear(_canvasBytes, 0, _canvasBytes.Length);
            Buffer.BlockCopy(_decoded, _decodedIndex * _decodedStride, _scaleSrcBytes, 0, _decodedStride);
            _canvasGfx.DrawImage(_scaleSrcBmp, new Rectangle(catX, catY, catW, catH));
            _lastSrcX = 0; _lastSrcY = 0; _lastSrcW = _frames.Width; _lastSrcH = _frames.Height;
        }

        /// <summary>
        /// 缩放档：只重画与上一帧的并集脏区。
        /// CPF 每帧自带改动矩形，缩放时按比例映射到目标区域，避免整幅双线性重采样。
        /// </summary>
        private void DrawScaledDirty(int catX, int catY, int catW, int catH)
        {
            if (_scaleSrcBmp == null || _decoded == null || _rectW == null) return;
            int sw = _frames.Width, sh = _frames.Height;
            int cx = _rectX[_decodedIndex], cy = _rectY[_decodedIndex];
            int cw = _rectW[_decodedIndex], ch = _rectH[_decodedIndex];
            if (cw <= 0 || ch <= 0) return;

            int ux = Math.Min(cx, _lastSrcX);
            int uy = Math.Min(cy, _lastSrcY);
            int ur = Math.Max(cx + cw, _lastSrcX + _lastSrcW);
            int ub = Math.Max(cy + ch, _lastSrcY + _lastSrcH);
            ux = Math.Max(0, ux - 2); uy = Math.Max(0, uy - 2);
            ur = Math.Min(sw, ur + 2); ub = Math.Min(sh, ub + 2);
            if (ur <= ux || ub <= uy) return;

            // 只把需要的行搬进常驻缓冲：源和目标都要加上 ux 偏移，
            // 否则源图左缘 (ur-ux) 宽的内容会被贴到目标 [0, ur-ux)，
            // 真正的 [ux, ur) 区域反而残留旧像素
            int baseOff = _decodedIndex * _decodedStride;
            int colBytes = (ur - ux) * 4;
            for (int y = uy; y < ub; y++)
            {
                Buffer.BlockCopy(_decoded, baseOff + y * sw * 4 + ux * 4,
                                 _scaleSrcBytes, y * sw * 4 + ux * 4, colBytes);
            }

            int dx = Math.Max(0, catX + (int)Math.Floor(ux * _scale));
            int dy = Math.Max(0, catY + (int)Math.Floor(uy * _scale));
            int dr = Math.Min(_winW, catX + (int)Math.Ceiling(ur * _scale));
            int db = Math.Min(_winH, catY + (int)Math.Ceiling(ub * _scale));
            if (dr <= dx || db <= dy) return;

            int stride = _winW * 4;
            // 顶部气泡/Zzz 条每帧清空重画
            int band = Math.Max(0, Math.Min(catY, _winH));
            for (int y = 0; y < band; y++) Array.Clear(_canvasBytes, y * stride, stride);
            // 炸毛图标画在猫身内，固定位置，单独清一小块
            int ex = Math.Max(0, _winW - (int)Math.Ceiling(52 * _scale));
            int ey = Math.Max(0, (int)Math.Floor((TopSpace + 8 - 18) * _scale));
            int ew = Math.Min(_winW - ex, (int)Math.Ceiling(44 * _scale));
            int eh = Math.Min(_winH - ey, (int)Math.Ceiling(44 * _scale));
            for (int y = ey; y < ey + eh; y++) Array.Clear(_canvasBytes, y * stride + ex * 4, ew * 4);

            for (int y = dy; y < db; y++) Array.Clear(_canvasBytes, y * stride + dx * 4, (dr - dx) * 4);

            _canvasGfx.DrawImage(_scaleSrcBmp, new Rectangle(dx, dy, dr - dx, db - dy),
                new Rectangle(ux, uy, ur - ux, ub - uy), GraphicsUnit.Pixel);

            _lastSrcX = cx; _lastSrcY = cy; _lastSrcW = cw; _lastSrcH = ch;
        }

        private bool HasParticles()
        {
            lock (_hearts) { if (_hearts.Count > 0) return true; }
            lock (_fish) { if (_fish.Count > 0) return true; }
            return false;
        }

        /// <summary>只清猫身矩形以外的像素：矩形内每帧都会被整块覆盖。</summary>
        private void ClearOutside(int x, int y, int w, int h)
        {
            int stride = _winW * 4;
            int top = Math.Max(0, Math.Min(_winH, y));
            if (top > 0) Array.Clear(_canvasBytes, 0, top * stride);

            int bottom = Math.Max(0, Math.Min(_winH, y + h));
            if (bottom < _winH) Array.Clear(_canvasBytes, bottom * stride, (_winH - bottom) * stride);

            int left = Math.Max(0, Math.Min(_winW, x));
            int right = Math.Max(0, Math.Min(_winW, x + w));
            for (int row = top; row < bottom; row++)
            {
                int baseOff = row * stride;
                if (left > 0) Array.Clear(_canvasBytes, baseOff, left * 4);
                if (right < _winW) Array.Clear(_canvasBytes, baseOff + right * 4, (_winW - right) * 4);
            }
        }
        private void BlitFrame1x()
        {
            var src = _decoded;
            int sw = _frames.Width;
            int baseOffset = _decodedIndex * _decodedStride;
            int cy = TopSpace;
            int w = Math.Min(sw, _winW);
            int h = Math.Min(_frames.Height, _winH - cy);
            int dstStride = _winW * 4;
            for (int y = 0; y < h; y++)
            {
                Buffer.BlockCopy(src, baseOffset + y * sw * 4, _canvasBytes, (cy + y) * dstStride, w * 4);
            }
        }
        private void DrawSleeping()
        {
            if (_sleepFont == null)
            {
                _sleepFont = new Font("Microsoft YaHei", 12f * (float)_scale, FontStyle.Bold);
                _sleepBrush = new SolidBrush(Color.FromArgb(200, 120, 160, 220));
            }
            string z = "z z z";
            var size = _canvasGfx.MeasureString(z, _sleepFont);
            _canvasGfx.DrawString(z, _sleepFont, _sleepBrush, _winW - size.Width - 6 * (float)_scale, 4 * (float)_scale);
        }

        private void DrawAnnoyed(double now)
        {
            float pulse = (float)(0.85 + 0.15 * Math.Sin(now / 120.0));
            float cx = _winW - 34 * (float)_scale;
            float cy = (TopSpace + 8) * (float)_scale;
            float r = 13 * (float)_scale * pulse;
            if (_annoyBrush == null) _annoyBrush = new SolidBrush(Color.FromArgb(230, 230, 70, 90));
            using (var path = new GraphicsPath())
            {
                for (int i = 0; i < 8; i++)
                {
                    double a = i * Math.PI / 4;
                    float rr = (i % 2 == 0) ? r : r * 0.45f;
                    float x = cx + (float)Math.Cos(a) * rr;
                    float y = cy + (float)Math.Sin(a) * rr;
                    if (i == 0) path.AddLine(cx, cy, x, y);
                    else path.AddLine(path.GetLastPoint(), new PointF(x, y));
                }
                path.CloseFigure();
                _canvasGfx.FillPath(_annoyBrush, path);
            }
        }

        private void DrawParticles(double now)
        {
            lock (_hearts)
            {
                for (int i = _hearts.Count - 1; i >= 0; i--)
                {
                    var h = _hearts[i];
                    double age = (now - h.Start) / 900.0;
                    if (age >= 1) { _hearts.RemoveAt(i); continue; }
                    float y = h.Y - (float)(52 * age) * (float)_scale;
                    float x = h.X + (float)(Math.Sin(age * 6) * 6) * (float)_scale;
                    int alpha = (int)(255 * (1 - age));
                    DrawHeart(x, y, 5f * (float)_scale, Color.FromArgb(alpha, 255, 120, 155));
                }
                for (int i = _fish.Count - 1; i >= 0; i--)
                {
                    var f = _fish[i];
                    double age = (now - f.Start) / 900.0;
                    if (age >= 1) { _fish.RemoveAt(i); continue; }
                    float y = f.Y + (float)(60 * age) * (float)_scale;
                    int alpha = (int)(255 * Math.Min(1, (1 - age) * 2));
                    DrawFish(f.X, y, 8f * (float)_scale, Color.FromArgb(alpha, 255, 170, 70));
                }
            }
        }

        private void DrawHeart(float cx, float cy, float r, Color color)
        {
            using (var brush = new SolidBrush(color))
            using (var path = new GraphicsPath())
            {
                path.AddBezier(cx, cy + r * 0.4f, cx - r * 1.4f, cy - r * 0.8f, cx - r * 0.2f, cy - r * 1.6f, cx, cy - r * 0.5f);
                path.AddBezier(cx, cy - r * 0.5f, cx + r * 0.2f, cy - r * 1.6f, cx + r * 1.4f, cy - r * 0.8f, cx, cy + r * 0.4f);
                path.AddLine(cx, cy + r * 0.4f, cx, cy + r * 0.7f);
                _canvasGfx.FillPath(brush, path);
            }
        }

        private void DrawFish(float cx, float cy, float r, Color color)
        {
            using (var brush = new SolidBrush(color))
            {
                _canvasGfx.FillEllipse(brush, cx - r, cy - r * 0.6f, r * 1.6f, r * 1.2f);
                var tail = new PointF[]
                {
                    new PointF(cx + r * 0.55f, cy),
                    new PointF(cx + r * 1.25f, cy - r * 0.7f),
                    new PointF(cx + r * 1.25f, cy + r * 0.7f)
                };
                _canvasGfx.FillPolygon(brush, tail);
            }
        }

        private void DrawBubble()
        {
            string text = _bubbleText;
            if (string.IsNullOrEmpty(text)) return;
            if (_bubbleCache == null || _bubbleCacheText != text)
            {
                _bubbleCache?.Dispose();
                _bubbleCache = RenderBubble(text);
                _bubbleCacheText = text;
            }
            int x = Math.Max(2, (_winW - _bubbleCache.Width) / 2);
            _canvasGfx.DrawImageUnscaled(_bubbleCache, x, (int)(2 * _scale));
        }

        private Bitmap RenderBubble(string text)
        {
            Graphics measure = _canvasGfx;
            Bitmap scratch = null;
            if (measure == null)
            {
                scratch = new Bitmap(1, 1);
                measure = Graphics.FromImage(scratch);
            }

            try
            {
                using (var font = new Font("Microsoft YaHei", 10.5f * (float)_scale))
                {
                    var size = measure.MeasureString(text, font);
                    int padX = (int)(12 * _scale);
                    int padY = (int)(7 * _scale);
                    int w = (int)size.Width + padX * 2;
                    int h = (int)size.Height + padY * 2;
                    var bmp = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
                    using (var g = Graphics.FromImage(bmp))
                    {
                        g.SmoothingMode = SmoothingMode.AntiAlias;
                        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAlias;
                        using (var path = RoundedRect(new Rectangle(0, 0, w - 1, h - 1), (int)(12 * _scale)))
                        using (var brush = new SolidBrush(Color.FromArgb(242, 255, 255, 255)))
                        {
                            g.FillPath(brush, path);
                        }
                        using (var brush = new SolidBrush(Color.FromArgb(60, 60, 60)))
                        {
                            g.DrawString(text, font, brush, padX, padY - 1);
                        }
                    }
                    return bmp;
                }
            }
            finally
            {
                if (scratch != null)
                {
                    measure.Dispose();
                    scratch.Dispose();
                }
            }
        }

        private static GraphicsPath RoundedRect(Rectangle rect, int radius)
        {
            var path = new GraphicsPath();
            int d = radius * 2;
            path.AddArc(rect.X, rect.Y, d, d, 180, 90);
            path.AddArc(rect.Right - d, rect.Y, d, d, 270, 90);
            path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
            path.AddArc(rect.X, rect.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        // ---------------- 交互 ----------------

        public void Say(string text, int durationMs = 2600)
        {
            lock (_sync)
            {
                _bubbleText = text;
                _bubbleUntil = NowMs() + durationMs;
                _bubbleCacheText = null;
                
            }
        }

        public void AddHeart()
        {
            lock (_hearts)
            {
                _hearts.Add(new Heart
                {
                    X = (float)(_winW * (0.35 + Lines.Random.NextDouble() * 0.3)),
                    Y = (float)(_winH * (0.55 + Lines.Random.NextDouble() * 0.15)),
                    Start = NowMs()
                });
            }
        }

        public void AddFish()
        {
            lock (_hearts)
            {
                _fish.Add(new Heart
                {
                    X = (float)(_winW * (0.4 + Lines.Random.NextDouble() * 0.2)),
                    Y = (float)(_winH * 0.28),
                    Start = NowMs()
                });
            }
        }

        private static long NowMs() => DateTime.UtcNow.Ticks / TimeSpan.TicksPerMillisecond;


        private System.Windows.Forms.Timer _hopTimer;

        /// <summary>轻跳一下：窗口上抛 9px 再落回。</summary>
        public void Hop()
        {
            if (_physicsTimer != null || _hopTimer != null) return;
            int baseY = Top;
            long start = NowMs();
            _hopTimer = new System.Windows.Forms.Timer { Interval = 16 };
            _hopTimer.Tick += (s, e) =>
            {
                double t = (NowMs() - start) / 340.0;
                if (t >= 1)
                {
                    _hopTimer.Stop();
                    _hopTimer.Dispose();
                    _hopTimer = null;
                    SetWindowPos(Handle, IntPtr.Zero, Left, baseY, 0, 0, 0x0015);
                    return;
                }
                int dy = (int)(-Math.Sin(Math.PI * t) * 9 * _scale);
                SetWindowPos(Handle, IntPtr.Zero, Left, baseY + dy, 0, 0, 0x0015);
            };
            _hopTimer.Start();
        }
        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            Store.Log($"MouseDown btn={e.Button} at={Cursor.Position.X},{Cursor.Position.Y} left={Left} top={Top}");
            if (e.Button == MouseButtons.Left)
            {
                _dragging = true;
                _moved = false;
                _dragStart = NowMs();
                _dragOffset = new Point(Cursor.Position.X - Left, Cursor.Position.Y - Top);
                _downCursor = Cursor.Position;
                lock (_samples) { _samples.Clear(); _samples.Add(new Sample { T = _dragStart, X = Left, Y = Top }); }
                Capture = true;
                MarkInteraction();
            }
            else if (e.Button == MouseButtons.Right)
            {
                ShowContextMenu(Cursor.Position);
            }
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            if (!_dragging || _physicsTimer != null) return;
            var p = Cursor.Position;
            // 只有鼠标本身相对屏幕移动了才算拖动；
            // Hop() 等窗口自身动画移动窗口时，鼠标不动，不算 _moved
            if (Math.Abs(p.X - _downCursor.X) > 3 || Math.Abs(p.Y - _downCursor.Y) > 3) _moved = true;
            int x = p.X - _dragOffset.X;
            int y = p.Y - _dragOffset.Y;
            SetWindowPos(Handle, IntPtr.Zero, x, y, 0, 0, 0x0015 /*NOZORDER|NOACTIVATE|NOSIZE*/);
            lock (_samples)
            {
                _samples.Add(new Sample { T = NowMs(), X = x, Y = y });
                if (_samples.Count > 8) _samples.RemoveAt(0);
            }
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            Store.Log($"MouseUp btn={e.Button} dragging={_dragging} moved={_moved}");
            if (!_dragging) return;
            _dragging = false;
            Capture = false;

            if (_moved) { StartThrow(); return; }

            long now = NowMs();
            bool doubleClick = now - _lastClickAt < 350;
            _lastClickAt = now;
            if (doubleClick)
            {
                _lastClickAt = 0;
                CancelPendingPet();
                OpenPanelRequested?.Invoke();
                return;
            }

            // 第一击延迟 360ms 结算：双击的第二击在窗口期内取消它，
            // 避免每次双击看面板都白拿一次亲密度
            CancelPendingPet();
            _petTimer = new System.Windows.Forms.Timer { Interval = 360 };
            _petTimer.Tick += (s, ev) => { CancelPendingPet(); Petting?.Invoke(PetEvent.None); };
            _petTimer.Start();
        }

        private System.Windows.Forms.Timer _petTimer;

        private void CancelPendingPet()
        {
            if (_petTimer == null) return;
            _petTimer.Stop();
            _petTimer.Dispose();
            _petTimer = null;
        }

        private void StartThrow()
        {
            double vx = 0;
            lock (_samples)
            {
                if (_samples.Count >= 2)
                {
                    var first = _samples[0];
                    var last = _samples[_samples.Count - 1];
                    double dt = Math.Max(0.016, (last.T - first.T) / 1000.0);
                    vx = (last.X - first.X) / dt;
                    if (NowMs() - last.T > 150) vx = 0;
                }
            }
            _samplesClear();
            if (Math.Abs(vx) < 900) { ClampToWorkArea(); SaveWindowPos(); return; }

            _vx = Math.Max(-2600, Math.Min(2600, vx));
            _vy = -Math.Abs(vx) * 0.22;
            _px = Left;
            _py = Top;
            _physicsTimer = new System.Windows.Forms.Timer { Interval = 16 };
            _physicsTimer.Tick += PhysicsTick;
            _physicsTimer.Start();
        }

        private void _samplesClear() { lock (_samples) _samples.Clear(); }

        private void PhysicsTick(object sender, EventArgs e)
        {
            double dt = 1.0 / 60.0;
            _vy += 2600 * dt;
            _px += _vx * dt;
            _py += _vy * dt;

            var wa = Screen.FromPoint(new Point((int)_px, (int)_py)).WorkingArea;
            double left = wa.Left, top = wa.Top;
            double right = wa.Right - _winW, bottom = wa.Bottom - _winH;

            if (_px < left) { _px = left; _vx = Math.Abs(_vx) * 0.5; }
            if (_px > right) { _px = right; _vx = -Math.Abs(_vx) * 0.5; }
            if (_py > bottom) { _py = bottom; _vy = -Math.Abs(_vy) * 0.5; if (Math.Abs(_vy) < 60) _vy = 0; }
            if (_py < top) { _py = top; _vy = Math.Abs(_vy) * 0.5; }

            bool onFloor = _py >= bottom - 0.5;
            if (onFloor)
            {
                _vx *= 0.82;
                if (Math.Abs(_vx) < 20) _vx = 0;
            }
            SetWindowPos(Handle, IntPtr.Zero, (int)_px, (int)_py, 0, 0, 0x0015);

            if (onFloor && _vx == 0 && _vy == 0)
            {
                _physicsTimer.Stop();
                _physicsTimer.Dispose();
                _physicsTimer = null;
                SaveWindowPos();
            }
        }

        private void ClampToWorkArea()
        {
            var wa = Screen.FromPoint(new Point(Left + _winW / 2, Top + _winH / 2)).WorkingArea;
            int x = Math.Max(wa.Left, Math.Min(wa.Right - _winW, Left));
            int y = Math.Max(wa.Top, Math.Min(wa.Bottom - _winH, Top));
            if (x != Left || y != Top) SetWindowPos(Handle, IntPtr.Zero, x, y, 0, 0, 0x0015);
        }

        private void MarkInteraction()
        {
            _lastInteraction = Environment.TickCount;
            if (_mode == PetMode.Sleeping) Wake();
        }

        public void Wake()
        {
            _mode = PetMode.Idle;
        }

        public void SetMode(PetMode mode) { _mode = mode; }
        public PetMode Mode => _mode;

        // ---------------- 行为 ----------------

        private void StartBehavior()
        {
            if (_behaviorTimer != null) return;
            _behaviorTimer = new System.Windows.Forms.Timer { Interval = 1000 };
            _behaviorTimer.Tick += (s, e) => TickBehavior();
            _behaviorTimer.Start();
        }

        private static int GetSystemIdleMs()
        {
            var info = new LastInputInfo { cbSize = (uint)Marshal.SizeOf(typeof(LastInputInfo)) };
            if (!GetLastInputInfo(ref info)) return 0;
            return unchecked(Environment.TickCount - (int)info.dwTime);
        }

        private void TickBehavior()
        {
            long now = PetState.Now;
            _state.RefreshDay(now);

            int idle = GetSystemIdleMs();
            bool night = PetState.IsNight(DateTime.Now.Hour);
            int threshold = night ? 60_000 : 180_000;

            if (_mode != PetMode.Annoyed && _mode != PetMode.Sleeping && idle > threshold)
            {
                _mode = PetMode.Sleeping;
            }
            else if (_mode == PetMode.Sleeping && idle < 3000)
            {
                // 人回来了（有键鼠输入）就醒，不必等点击
                _mode = PetMode.Idle;
            }

            // 空闲衰减：睡觉和炸毛时同样在流逝（睡觉≠无敌），
            // 只有"正在生气"那 30 秒不计——它已经在炸毛时扣过了
            if (_mode != PetMode.Annoyed)
            {
                _state.IdleDecay(Environment.TickCount - _lastInteraction);
            }

            if (now > _state.AnnoyedUntil && _mode == PetMode.Annoyed) _mode = PetMode.Idle;
        }


        // ---------------- 面板/外部调用 ----------------

        public void PetFromPanel() { MarkInteraction(); Petting?.Invoke(PetEvent.None); }
        public void FeedFromPanel() { MarkInteraction(); Feeding?.Invoke(); }

        public void HidePet()
        {
            _visible = false;
            Hide();
            UpdateTrayTip();
        }

        public void ShowPet()
        {
            _visible = true;
            Show();
            UpdateTrayTip();
        }

        public void ExitApp() { ExitRequested?.Invoke(); }
        // ---------------- 菜单 / 托盘 ----------------

        private const int IdPet = 1001, IdFeed = 1002, IdShow = 1003, IdPanel = 1004,
            IdTop = 1005, IdSkin = 1008, IdMute = 1009, IdExit = 1010,
            IdScale100 = 1011, IdScale125 = 1012, IdScale150 = 1013, IdScale75 = 1014;

        private void ShowContextMenu(Point at)
        {
            IntPtr menu = CreatePopupMenu();
            AppendMenu(menu, 0, (IntPtr)IdPet, "摸摸头");
            AppendMenu(menu, 0, (IntPtr)IdFeed, "喂小鱼干");
            AppendMenu(menu, 0x800u, IntPtr.Zero, null);
            AppendMenu(menu, 0, (IntPtr)IdPanel, "打开面板");
            AppendMenu(menu, 0, (IntPtr)IdShow, _visible ? "藏起猫猫" : "显示猫猫");
            AppendMenu(menu, _state.Pinned ? 0x8u : 0u, (IntPtr)IdTop, "置顶");
            // 逐像素穿透是分层窗口的固有行为（始终开启），不再提供开关
            AppendMenu(menu, _state.Muted ? 0x8u : 0u, (IntPtr)IdMute, "静音");
            AppendMenu(menu, 0x800u, IntPtr.Zero, null);
            AppendMenu(menu, 0, (IntPtr)IdSkin, _state.Skin == "hijiki" ? "换成白猫" : "换成黑猫");
            AppendMenu(menu, 0, (IntPtr)IdExit, "退出");

            SetForegroundWindow(Handle);
            // TPM_RETURNCMD 下 TrackPopupMenu 直接返回所选 ID、不发送 WM_COMMAND，
            // 必须就地处理返回值；此前返回值被丢弃，真实点击菜单全部无响应
            int cmd = TrackPopupMenu(menu, 0x0002 /*RIGHTBUTTON*/ | 0x0100 /*RETURNCMD*/, at.X, at.Y, 0, Handle, IntPtr.Zero);
            DestroyMenu(menu);
            if (cmd > 0) HandleMenu(cmd);
            // 恢复消息泵：弹层结束后补一次消息，规避 SetForegroundWindow 留下的焦点卡死
            PostMessage(Handle, 0x0000 /*WM_NULL*/, IntPtr.Zero, IntPtr.Zero);
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_COMMAND)
            {
                int id = m.WParam.ToInt32() & 0xFFFF;
                HandleMenu(id);
            }
            else if (m.Msg == WM_TRAY)
            {
                int evt = m.LParam.ToInt32() & 0xFFFF;
                if (evt == 0x0205) ShowContextMenu(Cursor.Position); // WM_RBUTTONUP
                else if (evt == 0x0202) { _visible = !_visible; UpdateVisibility(); } // WM_LBUTTONUP
            }
            base.WndProc(ref m);
        }

        private void HandleMenu(int id)
        {
            switch (id)
            {
                case IdPet: Petting?.Invoke(PetEvent.None); break;
                case IdFeed: Feeding?.Invoke(); break;
                case IdPanel: OpenPanelRequested?.Invoke(); break;
                case IdShow: _visible = !_visible; UpdateVisibility(); break;
                case IdTop:
                    _state.Pinned = !_state.Pinned;
                    TopMost = _state.Pinned;
                    Store.Save(_state);
                    break;
                case IdMute:
                    _state.Muted = !_state.Muted;
                    Audio.Muted = _state.Muted;
                    Store.Save(_state);
                    break;
                case IdSkin: SwitchSkin(_state.Skin == "hijiki" ? "tororo" : "hijiki"); break;
                case IdExit: ExitRequested?.Invoke(); break;
            }
        }

        private void UpdateVisibility()
        {
            if (_visible) { Show(); SetWindowPos(Handle, IntPtr.Zero, Left, Top, _winW, _winH, 0x0010 | 0x0040); }
            else Hide();
            UpdateTrayTip();
        }

        private void LoadTrayIcon()
        {
            if (_trayAdded) return;
            string iconPath = Path.Combine(AssetsDir, "cat.ico");
            if (File.Exists(iconPath)) _trayIcon = LoadImage(IntPtr.Zero, iconPath, 1 /*IMAGE_ICON*/, 0, 0, 0x10 /*LR_LOADFROMFILE*/);
            if (_trayIcon == IntPtr.Zero) _trayIcon = SystemIcons.Application.Handle;

            var data = new NotifyIconData
            {
                cbSize = (uint)Marshal.SizeOf(typeof(NotifyIconData)),
                hWnd = Handle,
                uID = 1,
                uFlags = 0x1 | 0x2 | 0x4, // MESSAGE | ICON | TIP
                uCallbackMessage = WM_TRAY,
                hIcon = _trayIcon,
                szTip = "猫猫桌宠",
                szInfo = "",
                szInfoTitle = ""
            };
            _trayAdded = Shell_NotifyIcon(0 /*NIM_ADD*/, ref data);
            if (!_trayAdded) Store.Log("托盘图标创建失败");
        }

        private void UpdateTrayTip()
        {
            if (!_trayAdded) return;
            var data = new NotifyIconData
            {
                cbSize = (uint)Marshal.SizeOf(typeof(NotifyIconData)),
                hWnd = Handle,
                uID = 1,
                uFlags = 0x4,
                hIcon = _trayIcon,
                szTip = _visible ? "猫猫桌宠" : "猫猫桌宠（已隐藏）",
                szInfo = "",
                szInfoTitle = ""
            };
            Shell_NotifyIcon(1 /*NIM_MODIFY*/, ref data);
        }

        // ---------------- 位置 / 退出 ----------------

        private void PositionWindow(int x, int y)
        {
            var wa = Screen.PrimaryScreen.WorkingArea;
            if (x == int.MinValue || y == int.MinValue)
            {
                x = wa.Right - _winW - 24;
                y = wa.Bottom - _winH - 8;
            }
            x = Math.Max(wa.Left, Math.Min(wa.Right - _winW, x));
            y = Math.Max(wa.Top, Math.Min(wa.Bottom - _winH, y));
            SetWindowPos(Handle, IntPtr.Zero, x, y, _winW, _winH, 0x0014);
            _state.WindowX = x;
            _state.WindowY = y;
        }

        public void SaveWindowPos()
        {
            _state.WindowX = Left;
            _state.WindowY = Top;
            Store.Save(_state);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            _alive = false;
            _behaviorTimer?.Stop();
            _physicsTimer?.Stop();
            CancelPendingPet();
            if (_trayAdded)
            {
                var data = new NotifyIconData { cbSize = (uint)Marshal.SizeOf(typeof(NotifyIconData)), hWnd = Handle, uID = 1 };
                Shell_NotifyIcon(2 /*NIM_DELETE*/, ref data);
            }
            SaveWindowPos();
            base.OnFormClosing(e);
        }
    }
}
