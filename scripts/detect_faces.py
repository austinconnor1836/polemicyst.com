#!/usr/bin/env python3
"""Detect faces in an image using OpenCV Haar cascade.

Usage: python3 detect_faces.py <image_path>

Outputs JSON to stdout:
  {"face_count": 2, "face_area_pct": 12.5, "largest_face_pct": 8.3}

- face_count: number of faces detected
- face_area_pct: total face area as percentage of image area
- largest_face_pct: largest single face as percentage of image area

Exits 0 on success (even if no faces), 1 on error.
"""

import json
import sys

def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <image_path>", file=sys.stderr)
        sys.exit(1)

    image_path = sys.argv[1]

    try:
        import cv2
    except ImportError:
        print("Missing dependency: cv2 (opencv-python-headless)", file=sys.stderr)
        sys.exit(1)

    try:
        img = cv2.imread(image_path)
        if img is None:
            print(f"Error: could not read image {image_path}", file=sys.stderr)
            sys.exit(1)

        h, w = img.shape[:2]
        image_area = h * w

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        face_cascade = cv2.CascadeClassifier(cascade_path)

        faces = face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=4,
            minSize=(30, 30),
        )

        face_count = len(faces) if isinstance(faces, tuple) and len(faces) == 0 else len(faces)
        total_face_area = 0
        largest_face_area = 0

        if face_count > 0:
            for (x, y, fw, fh) in faces:
                area = fw * fh
                total_face_area += area
                largest_face_area = max(largest_face_area, area)

        result = {
            "face_count": face_count,
            "face_area_pct": round(total_face_area / image_area * 100, 2) if image_area > 0 else 0,
            "largest_face_pct": round(largest_face_area / image_area * 100, 2) if image_area > 0 else 0,
        }
        print(json.dumps(result))

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
