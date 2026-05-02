# Personal Navigation

Personal Navigation 是一个轻量的自托管导航主页，用来放常用链接、快速搜索、便签、天气和 AI 翻译。它适合作为浏览器起始页：可以管理导航分类，使用 Google、百度、必应搜索，查看当前天气，保存一段服务器端便签，并用兼容 OpenAI Chat Completions 的模型做翻译。

英文文档：[README.md](README.md)

## 功能

- 可编辑的导航分类和链接
- Google、百度、必应快速搜索按钮
- 基于和风天气的天气组件
- 保存在服务器端的轻量便签
- 可折叠翻译模块，支持原文、补充说明、Markdown 译文、复制和目标语言/自定义目标要求
- 三个内置主题：默认、纸感、午夜

## 快速开始

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

然后打开：

```text
http://127.0.0.1:5555
```

生产环境可以放在自己的 Web 服务器或进程管理器后面运行：

```bash
gunicorn -c gunicorn_conf.py app:app
```

## 配置

推荐用环境变量配置。常用配置项可以参考 `env.example`。

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `SITE_TITLE` | 页面标题和主标题 | `Personal Navigation` |
| `DEFAULT_WEATHER_LOCATION_ID` | 默认和风天气城市 ID | `101010100` |
| `DEFAULT_WEATHER_LOCATION_NAME` | 天气加载前显示的默认城市名称 | `Beijing` |
| `DEFAULT_SEARCH_ENGINE` | 搜索框按回车时使用的搜索引擎。可选值：`google`、`baidu`、`bing` | `google` |
| `SHORTCUT_ONE_LABEL` | 第一个快捷卡片的显示名称 | `Shortcut 1` |
| `SHORTCUT_ONE_URL` | 第一个快捷卡片打开的地址 | `https://example.com/shortcut-1` |
| `SHORTCUT_TWO_LABEL` | 第二个快捷卡片的显示名称 | `Shortcut 2` |
| `SHORTCUT_TWO_URL` | 第二个快捷卡片打开的地址 | `https://example.com/shortcut-2` |
| `NAV_DEFAULT_TITLE_FONT` | 默认主题标题字体 | `system-ui` |
| `NAV_DEFAULT_BODY_FONT` | 默认主题正文和控件字体 | `system-ui` |
| `NAV_EDITORIAL_TITLE_FONT` | 纸感主题标题字体 | `Songti SC` |
| `NAV_EDITORIAL_BODY_FONT` | 纸感主题正文和控件字体 | `Songti SC` |
| `NAV_MIDNIGHT_TITLE_FONT` | 午夜主题标题字体 | `Hiragino Sans GB` |
| `NAV_MIDNIGHT_BODY_FONT` | 午夜主题正文和控件字体 | `Hiragino Sans GB` |
| `QWEATHER_API_KEY` | 和风天气 API key，用于天气和城市搜索 | 空 |
| `NAV_TRANSLATOR_API_KEY` | 翻译模型服务的 API key | 空 |
| `NAV_TRANSLATOR_BASE_URL` | 兼容 OpenAI 的 API base URL | `https://api.siliconflow.cn/v1` |
| `NAV_TRANSLATOR_MODEL` | 翻译模块使用的聊天模型 | `deepseek-ai/DeepSeek-V3.2` |
| `NAV_TRANSLATOR_TIMEOUT` | 翻译请求超时时间，单位秒 | `90` |

翻译模块也支持读取 `SILICONFLOW_API_KEY` 或 `DEEPSEEK_API_KEY`，方便使用供应商命名的环境变量。

字体配置接受 CSS font-family 写法。应用不内置字体文件；如果用户机器没有配置的字体，浏览器会回到系统 UI 字体栈。

也可以用本地配置文件配置翻译模块：

```bash
cp translator_config.example.json translator_config.json
```

`translator_config.json` 只放在实际运行应用的机器上。若部署平台支持密钥管理，也可以改用环境变量。

## 导航数据

编辑 `data.py` 配置导航分类和链接：

```python
websites = {
    'Example 1': {
        'Group A': [
            {'name': 'Example Site', 'url': 'https://example.com/'},
            {'name': 'Example Docs', 'url': 'https://example.com/docs'},
        ],
    },
    'Example 2': {
        'Group B': [
            {'name': 'Example Tool', 'url': 'https://example.net/tool'},
        ],
    },
}
```

顶层 key 是分类。分类可以继续分组，也可以直接放链接。页面里的编辑控件也能更新导航数据，并保存回 `data.py`。

## 主题

应用在 `app.py` 里内置了三个主题：

- `default`
- `editorial`
- `midnight`

页面会显示主题切换按钮，浏览器会记住已选择的主题。如果要新增主题，可以在 `THEME_PRESETS` 中加一个主题 ID，并在 `static/css/index.css` 中补对应的 CSS 变量。

## 安全说明

这个应用不内置登录系统。如果你要把它暴露到公网，请放在自己的访问控制、反向代理认证、VPN 或私有网络后面。

API key、本地翻译配置、便签、应用保存的数据和日志只应保存在服务器本地。不要公开包含个人链接、便签或凭据的文件。
