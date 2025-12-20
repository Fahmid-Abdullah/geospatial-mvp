## Environment Setup (Conda)

1. Install Conda  
   Download and install Anaconda from:  
   https://www.anaconda.com/download

2. After installation, open the **Anaconda Prompt**  
   Navigate to the directory containing `environment.yml` (or copy the file to a reachable directory):
   ```bash
   cd path/to/your/project
3. Create the Conda environment:
   ```bash
   conda env create -f environment.yml
4. Activate the environment:
   ```bash
   conda activate geo
5. Verify the environment:
   ```bash
   python --version
   python -c "import geopandas, rasterio, gdal, supabase"
6. If no errors occur, the environment is ready.
7. Open georeference.py in VS Code and select the geo environment as the Python interpreter.
8. In a VS Code terminal, navigate to the backend directory (should say geo in brackets on the left) and run:
   ```bash
   python georeference.py
