1. InstallConda (https://www.anaconda.com/download)
2. After install, open Anaconda prompt, cd into directory with environment.yml (or copy it somewhere reachable)
3. Run: conda env create -f environment.yml
4. conda activate geo
5. Verify: 
  - Run: python --version
  - Run: python -c "import geopandas, rasterio, gdal, supabase"
6. If no errors, it is ready.
7. Open georeference.py in VSCode, select geo environment as python interpreter
8. In VS Code terminal in backend directory: Run python georeference.py
