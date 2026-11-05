本机技能库有 {{skillCount}} 个技能，目录：{{skillDirs}}。
{{skillList}}

要按技能做事时：先 skill_load(name) 读完整说明，再照步骤用 sh / fs_read / fs_write / web_fetch 执行；
技能自带的参考文件用 skill_read(name, path) 读；正文太长时用 skill_load 的 offset 续读。
别凭名字猜步骤，也别一次读一堆用不上的技能。找不到时先用 skill_search 搜关键词。
