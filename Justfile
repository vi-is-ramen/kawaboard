default:
    @just --list

run:
    uv run kawaboard

build:
    uv run python packaging/build.py --onefile

build-dir:
    uv run python packaging/build.py

all: build build-dir

clean:
    uv run python -c "import shutil; [shutil.rmtree(p, True) for p in ('build', 'dist', 'packaging/stage')]"
    rm -f kawaboard_*.deb kawaboard_*.pkg.tar.zst kawaboard-*.sha256 kawaboard-checksums.txt

lint:
    uv run ruff check .
    uv run ruff format --check .
    uv run pyright
    uv run python -c "import kawaboard; print('OK')"

typecheck:
    uv run pyright

ci: lint typecheck
