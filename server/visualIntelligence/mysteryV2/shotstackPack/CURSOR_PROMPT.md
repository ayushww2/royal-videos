Integrate the Shotstack Mystery Documentary Pack v2 Final into the existing renderer.

Requirements:
- Load every JSON file from `templates/`.
- Preserve the preset visual structure and merge fields.
- Use public HTTPS image URLs.
- Do not add labels, debug borders, preset names, or extra text.
- Glass slideshow presets must display only one landscape image at a time.
- Each slideshow is 9 seconds: IMAGE_1 0–3s, IMAGE_2 3–6s, IMAGE_3 6–9s.
- The slideshow image is 1550×870 and centered.
- Side-by-side contains two images only, black background, white borders, no text.
- Red grid contains one image only, centered, no text.
- Render one test for each preset using the Shotstack stage endpoint before reporting success.
