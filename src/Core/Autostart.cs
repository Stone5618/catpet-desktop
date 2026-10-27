using System;
using Microsoft.Win32;
using System.Windows.Forms;

namespace CatPet.Core
{
    /// <summary>开机自启：写 HKCU Run，卸载时可清理。</summary>
    public static class Autostart
    {
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string ValueName = "CatPet";

        public static bool IsEnabled()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(RunKey))
                {
                    if (key == null) return false;
                    var value = key.GetValue(ValueName) as string;
                    return !string.IsNullOrEmpty(value);
                }
            }
            catch { return false; }
        }

        public static void Set(bool enabled)
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(RunKey, true))
                {
                    if (key == null) return;
                    if (enabled) key.SetValue(ValueName, "\"" + Application.ExecutablePath + "\"");
                    else key.DeleteValue(ValueName, false);
                }
            }
            catch (Exception ex)
            {
                Store.Log("设置开机自启失败: " + ex.Message);
            }
        }
    }
}
