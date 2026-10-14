#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  echo '.env уже существует. Настройки сохранены.'
  exit 0
fi
umask 077
admin_secret=$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')
tv_secret=$(od -An -N10 -tx1 /dev/urandom | tr -d ' \n')
printf 'ADMIN_PASSWORD=%s\nTV_KEY=%s\nPORT=3000\nPUBLIC_URL=\nCOOKIE_SECURE=false\n' "$admin_secret" "$tv_secret" > .env
printf 'Создан .env. Пароль ведущего: %s\nКлюч телевизора: %s\nУкажите PUBLIC_URL в .env — адрес сервера, доступный телефонам.\n' "$admin_secret" "$tv_secret"
