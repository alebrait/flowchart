from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from django.contrib.auth import get_user_model
from django.db import close_old_connections
from django.test import TransactionTestCase

from .models import Diagram
from .services import compare_and_update_diagram


class DiagramRevisionConcurrencyTests(TransactionTestCase):
    reset_sequences = True

    def test_only_one_concurrent_writer_can_claim_a_revision(self):
        owner = get_user_model().objects.create_user(username="writer")
        diagram = Diagram.objects.create(owner=owner, title="Initial")
        barrier = Barrier(2)

        def save_title(title):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return compare_and_update_diagram(
                    diagram.pk,
                    0,
                    {
                        "title": title,
                        "description": "",
                        "viewport": {"x": 0, "y": 0, "zoom": 1},
                    },
                )
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(save_title, ["First writer", "Second writer"]))

        diagram.refresh_from_db()
        self.assertEqual(sorted(results), [0, 1])
        self.assertEqual(diagram.revision, 1)
        self.assertIn(diagram.title, ["First writer", "Second writer"])
