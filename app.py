import json
import os
import runpy
import tempfile
import gzip
from functools import lru_cache
from pathlib import Path
from pprint import pformat
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / 'data.py'
NOTE_FILE = BASE_DIR / 'note.json'
TRANSLATOR_CONFIG_FILE = BASE_DIR / 'translator_config.json'
SITE_TITLE = os.getenv('SITE_TITLE') or 'Personal Navigation'
DEFAULT_WEATHER_LOCATION_ID = os.getenv('DEFAULT_WEATHER_LOCATION_ID') or '101010100'
DEFAULT_WEATHER_LOCATION_NAME = os.getenv('DEFAULT_WEATHER_LOCATION_NAME') or 'Beijing'
DEFAULT_SEARCH_ENGINE = os.getenv('DEFAULT_SEARCH_ENGINE') or 'google'
SHORTCUT_ONE_LABEL = os.getenv('SHORTCUT_ONE_LABEL') or 'Shortcut 1'
SHORTCUT_ONE_URL = os.getenv('SHORTCUT_ONE_URL') or 'https://example.com/shortcut-1'
SHORTCUT_TWO_LABEL = os.getenv('SHORTCUT_TWO_LABEL') or 'Shortcut 2'
SHORTCUT_TWO_URL = os.getenv('SHORTCUT_TWO_URL') or 'https://example.com/shortcut-2'
QWEATHER_KEY = os.getenv('QWEATHER_API_KEY') or os.getenv('WEATHER_KEY') or ''
DEFAULT_TRANSLATOR_BASE_URL = 'https://api.siliconflow.cn/v1'
DEFAULT_TRANSLATOR_MODEL = 'deepseek-ai/DeepSeek-V3.2'
TRANSLATOR_SOURCE_LIMIT = 24000
TRANSLATOR_CONTEXT_LIMIT = 8000
TRANSLATOR_TARGET_LIMIT = 200

THEME_PRESETS = [
    {'id': 'default', 'name': '默认'},
    {'id': 'editorial', 'name': '纸感'},
    {'id': 'midnight', 'name': '午夜'},
]


@lru_cache(maxsize=None)
def asset_version(relative_path: str) -> int:
    target = BASE_DIR / relative_path
    try:
        return int(target.stat().st_mtime)
    except OSError:
        return 0


app.jinja_env.globals['asset_version'] = asset_version


def _atomic_write_text(target: Path, content: str) -> None:
    """Write text to disk atomically on Windows and Unix."""
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_file = None
    try:
        with tempfile.NamedTemporaryFile(
            'w',
            encoding='utf-8',
            dir=target.parent,
            prefix=f'.{target.stem}.',
            suffix='.tmp',
            delete=False,
        ) as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
            temp_file = Path(handle.name)
        temp_file.replace(target)
    finally:
        if temp_file and temp_file.exists() and temp_file != target:
            temp_file.unlink(missing_ok=True)


def load_note():
    if not NOTE_FILE.exists():
        return {'content': ''}

    try:
        with NOTE_FILE.open('r', encoding='utf-8') as handle:
            note_data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {'content': ''}

    if not isinstance(note_data, dict):
        return {'content': ''}

    return {'content': note_data.get('content', '')}


def save_note(content):
    _atomic_write_text(
        NOTE_FILE,
        json.dumps({'content': content}, ensure_ascii=False, indent=2),
    )


def load_websites():
    """Load the website tree directly from data.py."""
    try:
        namespace = runpy.run_path(str(DATA_FILE))
    except Exception:
        app.logger.exception('Failed to load websites from %s', DATA_FILE)
        return {}

    websites = namespace.get('websites', {})
    return websites if isinstance(websites, dict) else {}


def serialise_websites(websites):
    return 'websites = ' + pformat(websites, width=100, sort_dicts=False) + '\n'


def _fetch_json(url: str):
    request_obj = Request(
        url,
        headers={
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, identity',
            'User-Agent': 'PersonalNav/1.0',
        },
    )
    with urlopen(request_obj, timeout=10) as response:
        payload = response.read()
        if response.headers.get('Content-Encoding', '').lower() == 'gzip' or payload[:2] == b'\x1f\x8b':
            payload = gzip.decompress(payload)
        charset = response.headers.get_content_charset() or 'utf-8'
        return json.loads(payload.decode(charset))


def _post_json(url: str, payload: dict, headers: Optional[dict] = None, timeout: int = 60):
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    request_obj = Request(
        url,
        data=body,
        headers={
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'PersonalNav/1.0',
            **(headers or {}),
        },
        method='POST',
    )
    with urlopen(request_obj, timeout=timeout) as response:
        response_body = response.read()
        charset = response.headers.get_content_charset() or 'utf-8'
        return json.loads(response_body.decode(charset))


def _qweather_get(base_url: str, **params):
    if not QWEATHER_KEY:
        raise RuntimeError('QWeather key is not configured')

    query = urlencode({**params, 'key': QWEATHER_KEY})
    return _fetch_json(f'{base_url}?{query}')


def load_translator_config():
    config = {}
    if TRANSLATOR_CONFIG_FILE.exists():
        try:
            with TRANSLATOR_CONFIG_FILE.open('r', encoding='utf-8') as handle:
                loaded = json.load(handle)
            if isinstance(loaded, dict):
                config.update(loaded)
        except (OSError, json.JSONDecodeError):
            app.logger.exception('Failed to load translator config from %s', TRANSLATOR_CONFIG_FILE)

    base_url = (
        os.getenv('NAV_TRANSLATOR_BASE_URL')
        or config.get('base_url')
        or DEFAULT_TRANSLATOR_BASE_URL
    ).rstrip('/')
    endpoint = (
        os.getenv('NAV_TRANSLATOR_ENDPOINT')
        or config.get('endpoint')
        or f'{base_url}/chat/completions'
    )
    model = os.getenv('NAV_TRANSLATOR_MODEL') or config.get('model') or DEFAULT_TRANSLATOR_MODEL
    api_key = (
        os.getenv('NAV_TRANSLATOR_API_KEY')
        or os.getenv('SILICONFLOW_API_KEY')
        or os.getenv('DEEPSEEK_API_KEY')
        or config.get('api_key')
        or ''
    )
    timeout = int(os.getenv('NAV_TRANSLATOR_TIMEOUT') or config.get('timeout') or 90)

    return {
        'base_url': base_url,
        'endpoint': endpoint,
        'model': model,
        'api_key': api_key,
        'timeout': timeout,
    }


def build_translation_messages(source: str, context: str = '', target_language: str = '简体中文'):
    target_language = (target_language or '简体中文').strip() or '简体中文'
    context_block = ''
    if context:
        context_block = (
            '\n\n补充说明（这是背景信息或翻译要求，不是待翻译正文。'
            '不要翻译补充说明，不要把它原样复述到译文里，只在理解原文时参考）：\n'
            f'```text\n{context}\n```'
        )

    user_prompt = (
        f'请把下面“原文”翻译成以下目标语言或目标要求：{target_language}。'
        '原文可能是英语、日语、其他现代语言，也可能是中文古文或文言文。'
        '如果目标要求不是现实存在的语言，也请按目标要求创造性执行。'
        '如果原文包含技术词汇或专业词汇，请在译文后用简短的“术语说明”解释必要概念；'
        '术语说明也要遵循目标语言或目标要求。'
        '只输出译文和必要说明，允许使用 Markdown。\n\n'
        f'原文：\n```text\n{source}\n```'
        f'{context_block}'
    )
    return [
        {
            'role': 'system',
            'content': (
                '你是一个严谨又灵活的翻译助手。你的目标是把用户提供的原文译成自然、准确、'
                '符合目标语言或目标要求的文本。补充说明只作为背景和要求，不是要翻译的文本。'
            ),
        },
        {'role': 'user', 'content': user_prompt},
    ]


def request_translation_completion(messages):
    config = load_translator_config()
    if not config['api_key']:
        raise RuntimeError('Translator API key is not configured')

    payload = {
        'model': config['model'],
        'messages': messages,
        'temperature': 0.2,
        'max_tokens': 4000,
    }
    response = _post_json(
        config['endpoint'],
        payload,
        headers={'Authorization': f'Bearer {config["api_key"]}'},
        timeout=config['timeout'],
    )
    choices = response.get('choices') if isinstance(response, dict) else None
    if not choices:
        raise RuntimeError('Translator returned no choices')
    message = choices[0].get('message') if isinstance(choices[0], dict) else None
    content = message.get('content') if isinstance(message, dict) else None
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError('Translator returned empty content')
    return content.strip()

@app.route('/')
def index():
    websites = load_websites()
    return render_template(
        'index.html',
        websites=websites,
        theme_presets=THEME_PRESETS,
        page_meta={
            'title': SITE_TITLE,
            'default_city_id': DEFAULT_WEATHER_LOCATION_ID,
            'default_city_name': DEFAULT_WEATHER_LOCATION_NAME,
            'default_search_engine': DEFAULT_SEARCH_ENGINE,
            'shortcut_one_label': SHORTCUT_ONE_LABEL,
            'shortcut_one_url': SHORTCUT_ONE_URL,
            'shortcut_two_label': SHORTCUT_TWO_LABEL,
            'shortcut_two_url': SHORTCUT_TWO_URL,
            'site_count': sum(
                len(sites)
                for category in websites.values()
                for sites in (category.values() if isinstance(category, dict) else [category])
            ),
        },
    )

@app.route('/save', methods=['POST'])
def save():
    try:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            raise ValueError('No valid JSON object received')

        _atomic_write_text(DATA_FILE, serialise_websites(payload))
        return jsonify({'status': 'success'})
    except Exception as e:
        app.logger.exception('Error saving data')
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/note', methods=['GET'])
def get_note():
    return jsonify(load_note())

@app.route('/api/note', methods=['POST'])
def update_note():
    payload = request.get_json(silent=True) or {}
    content = payload.get('content', '')
    save_note(content)
    return jsonify({'success': True})


@app.route('/api/weather', methods=['GET'])
def weather():
    location = (request.args.get('location') or '').strip() or '101010100'
    try:
        payload = _qweather_get(
            'https://devapi.qweather.com/v7/weather/now',
            location=location,
        )
        return jsonify(payload)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as error:
        app.logger.exception('Weather proxy failed')
        return jsonify({'code': '500', 'message': str(error)}), 502


@app.route('/api/city-search', methods=['GET'])
def city_search():
    keyword = (request.args.get('keyword') or '').strip()
    if not keyword:
        return jsonify({'code': '200', 'location': []})

    try:
        payload = _qweather_get(
            'https://geoapi.qweather.com/v2/city/lookup',
            location=keyword,
        )
        return jsonify(payload)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as error:
        app.logger.exception('City search proxy failed')
        return jsonify({'code': '500', 'message': str(error)}), 502


@app.route('/api/translate', methods=['POST'])
def translate():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({'success': False, 'message': '请输入要翻译的原文'}), 400

    source = str(payload.get('source') or payload.get('text') or '').strip()
    context = str(payload.get('context') or '').strip()
    target_language = str(
        payload.get('targetLanguage')
        or payload.get('target_language')
        or payload.get('target')
        or '简体中文'
    ).strip() or '简体中文'
    if not source:
        return jsonify({'success': False, 'message': '请输入要翻译的原文'}), 400
    if len(source) > TRANSLATOR_SOURCE_LIMIT:
        return jsonify({'success': False, 'message': '原文太长，请分段翻译'}), 413
    if len(context) > TRANSLATOR_CONTEXT_LIMIT:
        return jsonify({'success': False, 'message': '补充说明太长，请压缩后重试'}), 413
    if len(target_language) > TRANSLATOR_TARGET_LIMIT:
        return jsonify({'success': False, 'message': '目标语言要求太长，请压缩后重试'}), 413

    messages = build_translation_messages(source, context, target_language)
    try:
        translation = request_translation_completion(messages)
        return jsonify({'success': True, 'translation': translation})
    except RuntimeError as error:
        status = 503 if 'API key' in str(error) else 502
        app.logger.exception('Translation failed')
        return jsonify({'success': False, 'message': str(error)}), status
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
        app.logger.exception('Translation provider request failed')
        return jsonify({'success': False, 'message': '翻译服务暂时不可用'}), 502

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5555, debug=False)
