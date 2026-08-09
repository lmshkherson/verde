#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Спершу встановіть Node.js — це разово, 5 хвилин:"
  echo "  https://nodejs.org  (кнопка LTS)"
  echo
  echo "  Після встановлення закрийте це вікно й запустіть файл знову."
  echo
  read -n 1 -s -r -p "  Натисніть будь-яку клавішу…"
  exit 1
fi

node scripts/start.mjs
