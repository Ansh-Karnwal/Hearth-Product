"""Declarative schema, JSON-serializable, mirroring butterbase's
"describe tables and columns" format. SQLiteStore builds CREATE TABLE
statements from this; a future ButterbaseStore would hand this same dict
to butterbase's schema API instead.
"""

SCHEMA = {
    "users": {
        "columns": {
            "id": {"type": "integer", "pk": True, "autoincrement": True},
            "phone_number": {"type": "text", "unique": True},
            "telegram_user_id": {"type": "integer", "unique": True},
            "display_name": {"type": "text"},
            "zip_code": {"type": "text"},
            "created_at": {"type": "text"},
        },
    },
    "price_intelligence": {
        "columns": {
            "id": {"type": "integer", "pk": True, "autoincrement": True},
            "item_name": {"type": "text"},
            "store": {"type": "text"},
            "zip_code": {"type": "text"},
            "price": {"type": "real"},
            "unit": {"type": "text"},
            "source": {"type": "text"},
            "observed_at": {"type": "text"},
        },
    },
    "purchase_requests": {
        "columns": {
            "id": {"type": "integer", "pk": True, "autoincrement": True},
            "user_id": {"type": "integer", "fk": "users.id"},
            "raw_text": {"type": "text"},
            "item_name": {"type": "text"},
            "quantity": {"type": "text"},
            "status": {"type": "text"},
            "chosen_store": {"type": "text"},
            "chosen_price": {"type": "real"},
            "created_at": {"type": "text"},
            "completed_at": {"type": "text"},
        },
    },
    "token_usage": {
        "columns": {
            "id": {"type": "integer", "pk": True, "autoincrement": True},
            "user_id": {"type": "integer", "fk": "users.id", "nullable": True},
            "operation": {"type": "text"},
            "model": {"type": "text"},
            "prompt_tokens": {"type": "integer"},
            "completion_tokens": {"type": "integer"},
            "total_tokens": {"type": "integer"},
            "request_id": {"type": "integer", "fk": "purchase_requests.id", "nullable": True},
            "created_at": {"type": "text"},
        },
    },
    "social_posts": {
        "columns": {
            "id": {"type": "integer", "pk": True, "autoincrement": True},
            "post_type": {"type": "text"},
            "channel": {"type": "text"},
            "content": {"type": "text"},
            "related_request_id": {"type": "integer", "fk": "purchase_requests.id", "nullable": True},
            "telegram_message_id": {"type": "integer"},
            "posted_at": {"type": "text"},
        },
    },
    "crowd_responses": {
        "columns": {
            "id": {"type": "integer", "pk": True, "autoincrement": True},
            "post_id": {"type": "integer", "fk": "social_posts.id"},
            "telegram_user_id": {"type": "integer"},
            "raw_text": {"type": "text"},
            "parsed_store": {"type": "text", "nullable": True},
            "parsed_price": {"type": "real", "nullable": True},
            "created_at": {"type": "text"},
        },
    },
}
