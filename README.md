# Personal Navigation

Personal Navigation is a small self-hosted homepage for bookmarks, quick search, notes, weather, and AI-assisted translation. It gives you a private browser start page that can keep frequently used links, run Google/Baidu/Bing searches, show current weather, save a lightweight note, and translate text with an OpenAI-compatible chat model.

Chinese documentation: [README.zh-CN.md](README.zh-CN.md)

## Features

- Bookmark groups with editable categories and links
- Google, Baidu, and Bing quick search buttons
- Weather widget powered by QWeather
- Local note widget saved on the server
- Collapsible translation panel with source text, optional context, Markdown output, copy action, and configurable target language
- Three built-in themes: default, paper-like editorial, and midnight

## Quick Start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Then open:

```text
http://127.0.0.1:5555
```

For production, run it behind your own web server or process manager:

```bash
gunicorn -c gunicorn_conf.py app:app
```

## Configuration

Set configuration with environment variables. `env.example` shows the commonly used values.

| Variable | What It Controls | Default |
| --- | --- | --- |
| `SITE_TITLE` | Page title and main heading | `Personal Navigation` |
| `DEFAULT_WEATHER_LOCATION_ID` | Default QWeather location ID | `101010100` |
| `DEFAULT_WEATHER_LOCATION_NAME` | Default city label shown before weather loads | `Beijing` |
| `DEFAULT_SEARCH_ENGINE` | Search engine used when pressing Enter in the search box. Valid values: `google`, `baidu`, `bing` | `google` |
| `SHORTCUT_ONE_LABEL` | Label for the first shortcut card | `Shortcut 1` |
| `SHORTCUT_ONE_URL` | URL opened by the first shortcut card | `https://example.com/shortcut-1` |
| `SHORTCUT_TWO_LABEL` | Label for the second shortcut card | `Shortcut 2` |
| `SHORTCUT_TWO_URL` | URL opened by the second shortcut card | `https://example.com/shortcut-2` |
| `QWEATHER_API_KEY` | QWeather API key for weather and city search | empty |
| `NAV_TRANSLATOR_API_KEY` | API key for the translation model provider | empty |
| `NAV_TRANSLATOR_BASE_URL` | OpenAI-compatible API base URL | `https://api.siliconflow.cn/v1` |
| `NAV_TRANSLATOR_MODEL` | Chat model used by the translator | `deepseek-ai/DeepSeek-V3.2` |
| `NAV_TRANSLATOR_TIMEOUT` | Translation request timeout in seconds | `90` |

The translator also accepts `SILICONFLOW_API_KEY` or `DEEPSEEK_API_KEY` if you prefer provider-specific environment variable names.

You can also configure the translator with a local file:

```bash
cp translator_config.example.json translator_config.json
```

Keep `translator_config.json` on the machine where the app runs. Use environment variables instead if your deployment platform manages secrets for you.

## Navigation Data

Edit `data.py` to define the bookmark structure:

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

Each top-level key is a category. A category can contain subgroups, or it can contain links directly. The edit controls in the page can also update the navigation data and save it back to `data.py`.

## Themes

The app includes three theme presets in `app.py`:

- `default`
- `editorial`
- `midnight`

The page shows theme switch buttons when presets exist. The selected theme is saved in the browser. You can add a new preset in `THEME_PRESETS` and define matching CSS variables in `static/css/index.css`.

## Security Notes

This app does not include a login system. If you expose it on the public internet, put it behind your own access control, reverse proxy authentication, VPN, or a private network.

Keep API keys, local translation settings, notes, saved app data, and logs on the server only. Do not publish files that contain personal links, notes, or credentials.
