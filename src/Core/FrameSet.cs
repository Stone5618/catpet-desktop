using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;

namespace CatPet.Core
{
    /// <summary>
    /// CPF1 帧容器解码器。
    /// 格式：magic 'CPF1' + uint16 w + uint16 h + uint16 fps + uint16 reserved + uint32 frames
    ///       每帧：uint8 type + uint32 len + bytes
    ///       type 0 = 关键帧（整幅 BGRA，Deflate）
    ///       type 1 = 差分（Deflate(uint16 x,y,w,h + 矩形 BGRA)）
    ///       type 2 = 无变化
    /// 播放：顺序解码；回到第一帧时复制已缓存的首帧，避免整段重解。
    /// </summary>
    public sealed class FrameSet : IDisposable
    {
        public int Width { get; private set; }
        public int Height { get; private set; }
        public int Fps { get; private set; }
        public int FrameCount { get; private set; }

        private readonly List<byte[]> _payloads = new List<byte[]>();
        private readonly List<byte> _types = new List<byte>();
        private byte[] _first;
        private byte[] _current;
        private int _cursor;
        private bool _started;

        public byte[] Current => _current;

        /// <summary>最近一帧实际改动的矩形（用于渲染时只重画脏区）。</summary>
        public int LastRectX { get; private set; }
        public int LastRectY { get; private set; }
        public int LastRectW { get; private set; }
        public int LastRectH { get; private set; }

        public static FrameSet Load(string path)
        {
            var set = new FrameSet();
            byte[] data = File.ReadAllBytes(path);
            if (data.Length < 16 || data[0] != (byte)'C' || data[1] != (byte)'P' || data[2] != (byte)'F' || data[3] != (byte)'1')
                throw new InvalidDataException("不是 CPF1 文件: " + path);

            set.Width = BitConverter.ToUInt16(data, 4);
            set.Height = BitConverter.ToUInt16(data, 6);
            set.Fps = BitConverter.ToUInt16(data, 8);
            set.FrameCount = (int)BitConverter.ToUInt32(data, 12);

            int pos = 16;
            for (int i = 0; i < set.FrameCount; i++)
            {
                byte type = data[pos];
                int len = (int)BitConverter.ToUInt32(data, pos + 1);
                pos += 5;
                var payload = new byte[len];
                Buffer.BlockCopy(data, pos, payload, 0, len);
                pos += len;
                set._types.Add(type);
                set._payloads.Add(payload);
            }

            set._current = new byte[set.Width * set.Height * 4];
            return set;
        }

        /// <summary>解压到可复用缓冲，避免每帧分配大数组（GC 压力）。</summary>
        private byte[] _scratch = new byte[0];

        private int InflateInto(byte[] data, out byte[] buffer)
        {
            int offset = 0;
            int length = data.Length;
            if (data.Length > 6 && data[0] == 0x78)
            {
                offset = 2;
                length = data.Length - 6;
            }

            int need = 8 + Width * Height * 4;
            if (_scratch.Length < need) _scratch = new byte[need];

            using (var input = new MemoryStream(data, offset, length))
            using (var deflate = new DeflateStream(input, CompressionMode.Decompress))
            {
                int total = 0;
                while (total < _scratch.Length)
                {
                    int n = deflate.Read(_scratch, total, _scratch.Length - total);
                    if (n <= 0) break;
                    total += n;
                }
                buffer = _scratch;
                return total;
            }
        }

        public void Reset()
        {
            if (_payloads.Count == 0) return;
            int len = InflateInto(_payloads[0], out var raw);
            Buffer.BlockCopy(raw, 0, _current, 0, Math.Min(len, _current.Length));
            if (_first == null) _first = (byte[])_current.Clone();
            else Buffer.BlockCopy(_current, 0, _first, 0, _current.Length);
            _cursor = 1;
            _started = true;
        }

        /// <summary>推进一帧，返回 BGRA 缓冲。</summary>
        public byte[] Next()
        {
            if (!_started) { Reset(); SetRect(0, 0, Width, Height); return _current; }

            if (_cursor >= _payloads.Count)
            {
                Buffer.BlockCopy(_first, 0, _current, 0, _current.Length);
                _cursor = 1;
                return _current;
            }

            byte type = _types[_cursor];
            if (type == 2)
            {
                _cursor++;
                return _current;
            }

            if (type == 1)
            {
                InflateInto(_payloads[_cursor], out var raw);
                int dx = BitConverter.ToUInt16(raw, 0);
                int dy = BitConverter.ToUInt16(raw, 2);
                int rw = BitConverter.ToUInt16(raw, 4);
                int rh = BitConverter.ToUInt16(raw, 6);
                SetRect(dx, dy, rw, rh);
                int stride = Width * 4;
                for (int y = 0; y < rh; y++)
                {
                    Buffer.BlockCopy(raw, 8 + y * rw * 4, _current, (dy + y) * stride + dx * 4, rw * 4);
                }
            }

            _cursor++;
            return _current;
        }

        private void SetRect(int x, int y, int w, int h)
        {
            LastRectX = x; LastRectY = y; LastRectW = w; LastRectH = h;
        }

        public void Dispose()
        {
            _payloads.Clear();
            _types.Clear();
            _first = null;
            _current = null;
        }
    }
}
