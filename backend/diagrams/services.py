from django.db.models import F
from django.utils import timezone

from .models import Diagram


def compare_and_update_diagram(diagram_id, expected_revision, snapshot):
    return Diagram.objects.filter(
        pk=diagram_id,
        revision=expected_revision,
    ).update(
        revision=F("revision") + 1,
        title=snapshot["title"],
        description=snapshot["description"],
        viewport=snapshot["viewport"],
        updated_at=timezone.now(),
    )
