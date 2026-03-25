#!/usr/bin/env python3
"""Remove background from an image using rembg (u2net model).

Usage: python3 remove_background.py <input.png> <output.png>

Outputs a transparent PNG. Exits 0 on success, 1 on failure.
"""

import sys

def main():
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input> <output>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    try:
        from rembg import remove
        from PIL import Image
    except ImportError as e:
        print(f"Missing dependency: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        img = Image.open(input_path)
        result = remove(img)
        result.save(output_path)
        print(f"OK: {output_path}")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
