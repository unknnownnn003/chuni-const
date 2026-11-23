# CHUNITHM 历代定数档案

[打开日服谱面矩阵](https://unknnownnn003.github.io/chuni-const/)

首页展示从初代到 MATE 的 22 个版本。点击曲名或曲绘可查各版本快照、谱师、配信日期和包内修订。按 `/` 搜索，按 Esc 关闭详情。筛选支持曲目分类、难度、版本、定数范围及变化类型。版本比较可选择两个快照。

## 本地运行与验证

使用 Python 3.11+ 和现代浏览器。已提交浏览器所需的压缩数据，常规构建仅依赖 Python 标准库。

```sh
python tools/build.py
python -m http.server 8080 --directory dist
```

打开 `http://localhost:8080/`。构建会验证数据包哈希、版本顺序、所有曲绘引用、谱面身份和历史分片，再给前端脚本与样式生成带哈希的文件名。推送到 main 后，GitHub Actions 会校验并部署到 Pages。

桌面及手机布局的浏览器回归测试使用 Playwright Chromium。

```sh
python -m pip install playwright
python -m playwright install chromium
python tests/browser.py
```

## 更新历史库

导出工具以 SQLite 只读模式打开 `compact/catalog.sqlite`，按 `versions.ordinal` 排列版本。重复指定 `--root` 可提供曲绘所在的多个磁盘根目录。首次导出验证源文件 SHA-256，将曲绘缩至最长边 208 px 的 WebP。后续运行复用已生成的同哈希缩略图。

```powershell
python -m pip install Pillow
$db = 'D:\Files\nonebot\nonebot_plugin_unibot\.tools\jp-hdd\compact\catalog.sqlite'
python tools/export.py $db --root 'E:\SDBT 11 in 1' --root 'E:\SDHD' --root 'D:\Files'
python tools/build.py --database $db
python tests/browser.py
```

传入 `--database` 会将每个普通谱面及 WORLD’S END 快照反解后与 SQLite 逐项比对，并核对事件总数。数据更新后提交 `site/data`。如增加新版本，同时按 ordinal 添加对应表头 WebP，并更新 `tools/logo-sources.txt`。

## 数据口径

- 以历史库的 identity 和 chart_identity 区分普通谱、ULTIMA、WORLD’S END、复刻和仅存在于包内的身份。同名条目可独立查询。
- 普通谱面保留 selected_hundredths 的百分之一精度。WORLD’S END 使用属性与星数。仅在两个快照都确认收录且定数已知时计算升降。
- 已删除、未推出、停用、可能存在和缺少快照分开呈现。确切配信、删除及复活标记读取历史事件。首次出现直接显示定数，以浅绿色提示。
- 主矩阵展示每版快照。同一版本内多次修订可在详情中展开。历史日期保留确切日期、日期区间和未知日期三种形式。
- 主索引用字典与游程编码压缩，历史事件每 16 首一组按需读取。曲名列和表头冻结，滚动时仅渲染视口附近的谱面。
- 数据覆盖到 MATE 快照的 2026-10-08。曲绘和 Logo 的权利归各自权利人所有。版本标识来源记录在 `tools/logo-sources.txt`。
