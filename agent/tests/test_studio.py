import pytest

from app.graph.studio import recusa_producao


def test_recusa_producao():
    with pytest.raises(RuntimeError):
        recusa_producao("postgresql://postgres.kwriuifcwyvdrxtspjiz:x@h:5432/postgres")
    recusa_producao("postgresql://postgres.utkqoiigimqzeenxkxdl:x@h:5432/postgres")
