"""Siteyi http://127.0.0.1:5173/ adresinde yayınlar.

Tarayıcı dosyaları önbelleğe almasın diye no-cache başlığı ekler; böylece
yapılan değişiklikler sayfa yenilenince hemen görünür.
"""
import http.server
import os

PORT = 5173


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), NoCacheHandler)
    print(f'LikeSpot çalışıyor: http://127.0.0.1:{PORT}/  (durdurmak için Ctrl+C)')
    server.serve_forever()
