#!/usr/bin/env bash
# Maneja la instancia MySQL dedicada de tiendaApp.
# Corre aislada en el puerto 3307, con su propio datadir, para no chocar
# con un MySQL de sistema que use el 3306.
#
#   ./scripts/db.sh start | stop | status | logs | shell
set -euo pipefail

DB_ROOT="${TIENDAAPP_DB_ROOT:-$HOME/.tiendaapp-db}"
CNF="$DB_ROOT/my.cnf"
ROOT_CNF="$DB_ROOT/root.cnf"

if [ ! -f "$CNF" ]; then
  echo "No existe $CNF. La instancia no está inicializada." >&2
  exit 1
fi

is_up() { mysqladmin --defaults-file="$ROOT_CNF" ping >/dev/null 2>&1; }

case "${1:-}" in
  start)
    if is_up; then echo "Ya está corriendo en el puerto 3307."; exit 0; fi
    nohup mysqld --defaults-file="$CNF" >"$DB_ROOT/logs/stdout.log" 2>&1 &
    until is_up; do sleep 0.5; done
    echo "MySQL arriba en 127.0.0.1:3307"
    ;;
  stop)
    if ! is_up; then echo "No estaba corriendo."; exit 0; fi
    mysqladmin --defaults-file="$ROOT_CNF" shutdown
    echo "MySQL detenido."
    ;;
  status)
    if is_up; then
      echo "corriendo — 127.0.0.1:3307 (datadir: $DB_ROOT/data)"
    else
      echo "detenido"
      exit 1
    fi
    ;;
  logs)
    tail -n 50 -f "$DB_ROOT/logs/error.log"
    ;;
  shell)
    mysql --defaults-file="$ROOT_CNF" -D "${2:-tienda_app}"
    ;;
  *)
    echo "uso: $0 {start|stop|status|logs|shell [db]}" >&2
    exit 1
    ;;
esac
