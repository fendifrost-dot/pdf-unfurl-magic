#!/bin/bash
# Double-click this in Finder after the project is on your Mac.
set -e
cd "$(dirname "$0")"
HERE="$(pwd -P)"
cd "$HERE"

if [ ! -f package.json ]; then
  echo "This launcher has to live inside the PDF Relief project folder."
  echo "That folder contains package.json. Yours is not this directory:"
  echo "  $HERE"
  echo
  echo "Create the repo, clone or unzip it onto this Mac, then double-click"
  echo "\"Open PDF Relief.command\" from inside that folder — not from Home."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js is not on your PATH. Install it from https://nodejs.org and try again."
  exit 1
fi

echo "Opening PDF Relief from:"
echo "  $HERE"
echo
npm install
npm run desktop
