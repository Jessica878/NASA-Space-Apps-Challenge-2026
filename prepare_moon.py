
import rasterio
from rasterio.enums import Resampling
from PIL import Image
import numpy as np
from pathlib import Path

# Original NASA lunar image
input_file = Path(
    r"C:\Users\natas\Downloads\LRO_WAC_Mosaic_SPole60_100mp.tif"
)

# Output folder inside the project
output_folder = Path("public/moon")
output_folder.mkdir(parents=True, exist_ok=True)

output_file = output_folder / "south-pole-mosaic.png"

print("Opening NASA lunar mosaic...")

with rasterio.open(input_file) as src:
    # Reduce image dimensions for web display
    scale = 4
    new_width = src.width // scale
    new_height = src.height // scale

    print("Reading and resizing image...")

    image = src.read(
        1,
        out_shape=(new_height, new_width),
        resampling=Resampling.average
    )

    # Convert grayscale data to PNG
    image = np.clip(image, 0, 255).astype(np.uint8)

    Image.fromarray(image).save(output_file)

    print("Original projection:", src.crs)
    print("Original bounds:", src.bounds)
    print("Output dimensions:", new_width, "x", new_height)

print("Finished!")
print("Saved to:", output_file)
