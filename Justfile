default:
    @just --list

run:
    uv run kawaboard

build:
    uv run python packaging/build.py --onefile

build-dir:
    uv run python packaging/build.py

all: build build-dir

check:
    uv run python -c "import kawaboard; print('kawaboard ok ^_^')"

clean:
    python -c "import shutil; [shutil.rmtree(p, True) for p in ('build', 'dist')]"
