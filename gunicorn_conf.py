import os

wsgi_app = 'app:app'

workers = int(os.getenv('GUNICORN_WORKERS', '2'))
threads = int(os.getenv('GUNICORN_THREADS', '2'))
worker_class = os.getenv('GUNICORN_WORKER_CLASS', 'sync')
bind = os.getenv('GUNICORN_BIND', '0.0.0.0:5555')
pidfile = os.getenv('GUNICORN_PIDFILE', 'gunicorn.pid')
accesslog = os.getenv('GUNICORN_ACCESS_LOG', '-')
errorlog = os.getenv('GUNICORN_ERROR_LOG', '-')
loglevel = os.getenv('GUNICORN_LOG_LEVEL', 'info')
timeout = int(os.getenv('GUNICORN_TIMEOUT', '60'))

user = os.getenv('GUNICORN_USER') or None
group = os.getenv('GUNICORN_GROUP') or None
