"""The built-in avatar catalog is shared by registration and profile settings."""

import secrets

AVATARS = (
    ("alpine", "山峦"),
    ("sunrise", "日出"),
    ("moon", "月色"),
    ("waves", "海浪"),
    ("island", "小岛"),
    ("forest", "森林"),
    ("leaf", "新叶"),
    ("flower", "花朵"),
    ("orange", "橘子"),
    ("planet", "行星"),
    ("rainbow", "彩虹"),
    ("sail", "帆船"),
)


def random_avatar():
    return "builtin:" + secrets.choice(AVATARS)[0]


def avatar_url(value):
    if value.startswith("upload:"):
        return "/avatars/uploads/" + value[7:] + ".webp"
    key = value[8:] if value.startswith("builtin:") else AVATARS[0][0]
    return "/avatars/" + key + ".svg"


def catalog():
    return [
        {"id": "builtin:" + key, "label": label, "url": avatar_url("builtin:" + key)}
        for key, label in AVATARS
    ]
