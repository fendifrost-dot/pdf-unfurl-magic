# Creates ~/Documents/pdf-relief on this Mac, then opens it in Finder.
# Run from Terminal, or double-click after the project is already on the Mac.
mkdir -p "$HOME/Documents/pdf-relief"
cd "$HOME/Documents/pdf-relief"
open .
echo "Created: $HOME/Documents/pdf-relief"
echo "Put the PDF Relief files in this folder so package.json is inside it."
echo "Then double-click Open PDF Relief.command"
