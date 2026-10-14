"""
Motion notification mails, configured through environment variables (see .env.example)
"""

import os
import smtplib
import threading
import time
from email.message import EmailMessage

SMTP_HOST = os.getenv('SMTP_HOST', '')
SMTP_PORT = int(os.getenv('SMTP_PORT', '587'))
SMTP_USER = os.getenv('SMTP_USER', '')
SMTP_PASSWORD = os.getenv('SMTP_PASSWORD', '')
SMTP_SECURITY = os.getenv('SMTP_SECURITY', 'starttls').lower()  # starttls, ssl or none
MAIL_FROM = os.getenv('MAIL_FROM') or SMTP_USER
MAIL_TO = [address.strip() for address in os.getenv('MAIL_TO', '').split(',') if address.strip()]
MAIL_COOLDOWN_S = float(os.getenv('MAIL_COOLDOWN_MINUTES', '5')) * 60  # per camera
HUB_URL = os.getenv('HUB_URL', '').rstrip('/')

ENABLED = bool(SMTP_HOST and MAIL_TO)

last_sent = {}  # camera ID -> time.monotonic() of the last mail
lock = threading.Lock()


def status():
    if not ENABLED:
        return "Motion mails disabled (set SMTP_HOST and MAIL_TO in .env)"
    return f"Motion mails to {', '.join(MAIL_TO)} via {SMTP_HOST}:{SMTP_PORT}, at most every {MAIL_COOLDOWN_S / 60:g} min per camera"


def notify_motion(camera_id, image, time_text):
    """Mail the first image of a motion event in the background, unless the camera's cooldown is running"""
    if not ENABLED:
        return
    now = time.monotonic()
    with lock:
        previous = last_sent.get(camera_id)
        if previous is not None and now - previous < MAIL_COOLDOWN_S:
            print(f"✉ Camera {camera_id}: motion mail skipped, cooldown running")
            return
        last_sent[camera_id] = now
    threading.Thread(target=send_mail, args=(camera_id, image, time_text, previous), daemon=True).start()


def send_mail(camera_id, image, time_text, previous):
    message = EmailMessage()
    message['Subject'] = f'Bewegung erkannt – Kamera {camera_id} um {time_text}'
    message['From'] = MAIL_FROM
    message['To'] = ', '.join(MAIL_TO)
    body = f'Kamera {camera_id} hat um {time_text} Uhr eine Bewegung erkannt.'
    if HUB_URL:
        body += f'\n\nZeitleiste: {HUB_URL}/#timeline/{camera_id}'
    message.set_content(body)
    message.add_attachment(image, maintype='image', subtype='jpeg',
                           filename=f'kamera-{camera_id}-{time_text.replace(":", "-")}.jpg')

    try:
        smtp_class = smtplib.SMTP_SSL if SMTP_SECURITY == 'ssl' else smtplib.SMTP
        with smtp_class(SMTP_HOST, SMTP_PORT, timeout=30) as smtp:
            if SMTP_SECURITY == 'starttls':
                smtp.starttls()
            if SMTP_USER:
                smtp.login(SMTP_USER, SMTP_PASSWORD)
            smtp.send_message(message)
        print(f"✉ Camera {camera_id}: motion mail sent to {', '.join(MAIL_TO)}")
    except Exception as e:  # Mail problems must never affect uploads
        print(f"✗ Camera {camera_id}: motion mail failed: {e}")
        with lock:  # Let the next event try again instead of waiting out the cooldown
            last_sent[camera_id] = previous
