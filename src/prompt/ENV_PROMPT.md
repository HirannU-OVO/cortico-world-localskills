本机技能库有 {{skillCount}} 个技能，目录：{{skillDirs}}。
{{skillList}}

要按技能做事时：先 skill_load(name) 读完整说明，再照步骤用 sh / fs_read / fs_write / web_fetch 执行；
技能自带的参考文件用 skill_read(name, path) 读；正文太长时用 skill_load 的 offset 续读。
别凭名字猜步骤，也别一次读一堆用不上的技能。找不到时先用 skill_search 搜关键词。

如果现有的都不合适、而这套做法以后还会重复用，就用 skill_create 现写一个：
名字用小写字母/数字/连字符，说明写清「做什么 + 什么时候该用」，正文按步骤写，把踩过的坑和验证方法一并写进去。
只服务这一次的临时操作不要建技能，直接做完就行；建完它会进索引，下次同类任务直接 skill_load 复用。
