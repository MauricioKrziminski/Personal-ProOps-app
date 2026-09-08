import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.graph.schemas import FinanceAction
from app.services import gemini
from pydantic import Field, create_model


async def main():
    for count in [17, 16]:
        fields = {
            n: (f.annotation, Field(default=f.default, description=f.description))
            for n, f in FinanceAction.model_fields.items()
            if n != "installment_scope" and (count == 17 or n != "already_paid_count")
        }
        fields["installment_scope"] = (
            str | None,
            Field(
                None,
                description="Existing payment subset: first:8, last:2, range:3:8, dates:2026-01-01:2026-08-31, all or unclear. Creation paid history: paid:8.",
            ),
        )
        action = create_model("FinanceWireAction", **fields)
        plan = create_model(
            "FinanceWirePlan",
            actions=(list[action], Field(default_factory=list)),
            confidence=(float, 1.0),
        )
        try:
            r = await gemini.structured(plan).ainvoke(
                [("human", "Todas as 8 anteriores do carro, marque como pagas")]
            )
            print("PASS", count, r.model_dump_json(), flush=True)
        except Exception as e:  # noqa: BLE001 — diagnostic reports model rejection
            print("FAIL", count, type(e).__name__, str(e)[-250:], flush=True)


asyncio.run(main())
