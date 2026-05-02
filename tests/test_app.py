import json
import os
import tempfile
import unittest
from pathlib import Path
from pprint import pformat
from unittest.mock import patch

import app as app_module


SAMPLE_WEBSITES = {
    'Example 1': [
        {'name': 'Example Site', 'url': 'https://example.com/'},
        {'name': 'Example Docs', 'url': 'https://example.com/docs'},
    ],
    'Example 2': {
        'Group A': [
            {'name': 'Example App', 'url': 'https://example.org/app'},
        ]
    },
}


class AppRouteTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.data_file = self.root / 'data.py'
        self.note_file = self.root / 'note.json'
        self.rogue_cwd = self.root / 'rogue-cwd'
        self.rogue_cwd.mkdir()

        self.original_data_file = app_module.DATA_FILE
        self.original_note_file = app_module.NOTE_FILE
        self.original_translator_config_file = app_module.TRANSLATOR_CONFIG_FILE
        self.original_cwd = Path.cwd()

        self.data_file.write_text(
            'websites = ' + pformat(SAMPLE_WEBSITES, width=100, sort_dicts=False) + '\n',
            encoding='utf-8',
        )

        app_module.DATA_FILE = self.data_file
        app_module.NOTE_FILE = self.note_file
        app_module.TRANSLATOR_CONFIG_FILE = self.root / 'translator_config.json'
        app_module.app.config.update(TESTING=True)
        self.client = app_module.app.test_client()

        os.chdir(self.rogue_cwd)

    def tearDown(self):
        os.chdir(self.original_cwd)
        app_module.DATA_FILE = self.original_data_file
        app_module.NOTE_FILE = self.original_note_file
        app_module.TRANSLATOR_CONFIG_FILE = self.original_translator_config_file
        self.tempdir.cleanup()

    def test_index_renders_websites_from_absolute_data_file(self):
        response = self.client.get('/')
        body = response.get_data(as_text=True)

        self.assertEqual(response.status_code, 200)
        self.assertIn('Personal Navigation', body)
        self.assertIn('Example Site', body)
        self.assertIn('Example App', body)

    def test_note_round_trip_uses_project_root_file(self):
        get_response = self.client.get('/api/note')
        self.assertEqual(get_response.status_code, 200)
        self.assertEqual(get_response.get_json(), {'content': ''})

        post_response = self.client.post(
            '/api/note',
            json={'content': 'Remember the milk'},
        )
        self.assertEqual(post_response.status_code, 200)
        self.assertEqual(post_response.get_json(), {'success': True})
        self.assertEqual(
            json.loads(self.note_file.read_text(encoding='utf-8')),
            {'content': 'Remember the milk'},
        )

        second_get = self.client.get('/api/note')
        self.assertEqual(second_get.get_json(), {'content': 'Remember the milk'})

    def test_save_updates_data_file_with_valid_python_literal(self):
        payload = {
            '工具': [
                {'name': 'New Site', 'url': 'https://example.com'},
            ],
            '学习': {
                '教程': [
                    {'name': 'Docs', 'url': 'https://docs.example.com'},
                ]
            },
        }

        response = self.client.post('/save', json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'status': 'success'})

        saved_text = self.data_file.read_text(encoding='utf-8')
        self.assertIn('websites = ', saved_text)
        self.assertIn("'New Site'", saved_text)
        self.assertIn("'Docs'", saved_text)

        refreshed = self.client.get('/')
        body = refreshed.get_data(as_text=True)
        self.assertIn('New Site', body)
        self.assertIn('Docs', body)

    @patch('app._qweather_get')
    def test_weather_proxy_uses_backend_route(self, mock_qweather_get):
        mock_qweather_get.return_value = {
            'code': '200',
            'now': {'temp': '18', 'text': '晴'},
        }

        response = self.client.get('/api/weather?location=101010100')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['now']['temp'], '18')
        mock_qweather_get.assert_called_once_with(
            'https://devapi.qweather.com/v7/weather/now',
            location='101010100',
        )

    @patch('app._qweather_get')
    def test_city_search_proxy_uses_backend_route(self, mock_qweather_get):
        mock_qweather_get.return_value = {
            'code': '200',
            'location': [{'id': '101010100', 'name': '北京'}],
        }

        response = self.client.get('/api/city-search?keyword=北京')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['location'][0]['name'], '北京')
        mock_qweather_get.assert_called_once_with(
            'https://geoapi.qweather.com/v2/city/lookup',
            location='北京',
        )

    @patch('app.request_translation_completion')
    def test_translate_passes_source_and_context_to_model(self, mock_translation):
        mock_translation.return_value = '你好，世界。'

        response = self.client.post(
            '/api/translate',
            json={
                'source': 'Hello, world.',
                'context': 'This appears in a developer tool changelog.',
                'targetLanguage': '日文',
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json(),
            {'success': True, 'translation': '你好，世界。'},
        )
        messages = mock_translation.call_args.args[0]
        user_prompt = messages[-1]['content']
        self.assertIn('Hello, world.', user_prompt)
        self.assertIn('This appears in a developer tool changelog.', user_prompt)
        self.assertIn('日文', user_prompt)
        self.assertIn('不要翻译补充说明', user_prompt)

    @patch('app.request_translation_completion')
    def test_translate_defaults_target_language_to_simplified_chinese(self, mock_translation):
        mock_translation.return_value = '早上好。'

        response = self.client.post('/api/translate', json={'source': 'Good morning.'})

        self.assertEqual(response.status_code, 200)
        messages = mock_translation.call_args.args[0]
        self.assertIn('简体中文', messages[-1]['content'])

    @patch('app.request_translation_completion')
    def test_translate_rejects_empty_source(self, mock_translation):
        response = self.client.post('/api/translate', json={'source': '   '})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['success'], False)
        mock_translation.assert_not_called()


if __name__ == '__main__':
    unittest.main()
