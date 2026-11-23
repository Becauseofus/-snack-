using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;
class LocalInstaller {
 [STAThread] static int Main(string[] args) {
  bool silent = args.Length == 2 && args[0] == "--extract";
  try {
   string destination;
   if (silent) destination = args[1];
   else {
    Application.EnableVisualStyles();
    using (var picker = new FolderBrowserDialog()) {
     picker.Description = "选择独立文件夹安装「贪吃蛇」";
     picker.SelectedPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "贪吃蛇");
     if (picker.ShowDialog() != DialogResult.OK) return 0;
     destination = picker.SelectedPath;
    }
   }
   destination = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar);
   if (destination == Path.GetPathRoot(destination).TrimEnd(Path.DirectorySeparatorChar)) throw new Exception("请选择独立文件夹，不能选择磁盘根目录。");
   if ((File.Exists(Path.Combine(destination,"Snake.exe")) || File.Exists(Path.Combine(destination,"贪吃蛇.exe"))) && !File.Exists(Path.Combine(destination,"LOCAL-BUILD.txt"))) throw new Exception("此文件夹已有其他版本，请另选一个文件夹。");
   Directory.CreateDirectory(destination);
   using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
   using (var archive = new ZipArchive(stream, ZipArchiveMode.Read)) {
    foreach (var entry in archive.Entries) {
     var target = Path.GetFullPath(Path.Combine(destination, entry.FullName));
     if (!target.StartsWith(destination + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new Exception("安装内容包含无效路径。");
     if (entry.Name.Length == 0) { Directory.CreateDirectory(target); continue; }
     Directory.CreateDirectory(Path.GetDirectoryName(target));
     using (var input = entry.Open()) using (var output = File.Create(target)) input.CopyTo(output);
    }
   }
   File.Copy(Path.Combine(destination,"Snake.exe"), Path.Combine(destination,"贪吃蛇.exe"), true);
   File.Delete(Path.Combine(destination,"Snake.exe"));
   if (!silent) {
    dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
    dynamic shortcut = shell.CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "贪吃蛇.lnk"));
    shortcut.TargetPath = Path.Combine(destination, "贪吃蛇.exe");
    shortcut.WorkingDirectory = destination;
    shortcut.Save();
    MessageBox.Show("安装完成。通过桌面「贪吃蛇」启动，在皮肤菜单中选择「金鳞祥龙」，对局中按空格盘身。\n\n安装目录：" + destination, "贪吃蛇");
   }
   return 0;
  } catch (Exception e) {
   if (!silent) MessageBox.Show(e.Message, "安装失败");
   else Console.Error.WriteLine(e);
   return 1;
  }
 }
}
