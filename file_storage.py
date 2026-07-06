# -*- coding: utf-8 -*-
"""Persistent private-file storage backed by Vercel Blob."""

import mimetypes
import os
import re
from datetime import datetime, timezone
from pathlib import PurePath
from uuid import uuid4

from vercel.blob import delete, get, list_objects, put


class FileStorageError(RuntimeError):
    """Raised when the file store is unavailable or an operation fails."""


class FileStorage:
    PREFIX = "nana-files/"

    @staticmethod
    def is_configured():
        return bool(os.environ.get("BLOB_READ_WRITE_TOKEN"))

    @staticmethod
    def _require_config():
        if not FileStorage.is_configured():
            raise FileStorageError("文件存储尚未配置")

    @staticmethod
    def _safe_name(filename):
        name = PurePath(filename or "未命名文件").name
        name = re.sub(r'[\x00-\x1f\\/:*?"<>|]+', "_", name).strip(" .")
        return (name or "未命名文件")[:160]

    @staticmethod
    def _safe_category(category):
        value = re.sub(r"[^a-zA-Z0-9_-]+", "-", category or "documents")
        return value.strip("-")[:40] or "documents"

    @staticmethod
    def display_name(pathname):
        """Remove the timestamp and random id used in stored object names."""
        return PurePath(pathname).name.split("-", 2)[-1]

    @classmethod
    def _validate_pathname(cls, pathname):
        if not pathname or not pathname.startswith(cls.PREFIX):
            raise FileStorageError("无效的文件路径")
        return pathname

    @classmethod
    def upload(cls, filename, content, content_type=None, category="documents"):
        cls._require_config()
        safe_name = cls._safe_name(filename)
        safe_category = cls._safe_category(category)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        pathname = (
            f"{cls.PREFIX}{safe_category}/"
            f"{timestamp}-{uuid4().hex[:10]}-{safe_name}"
        )
        mime = content_type or mimetypes.guess_type(safe_name)[0]
        blob = put(
            pathname,
            content,
            access="private",
            content_type=mime or "application/octet-stream",
        )
        return {
            "pathname": blob.pathname,
            "filename": safe_name,
            "content_type": blob.content_type,
            "url": blob.url,
            "download_url": blob.download_url,
            "size": len(content),
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        }

    @classmethod
    def list_files(cls, limit=100, cursor=None):
        cls._require_config()
        result = list_objects(
            prefix=cls.PREFIX,
            limit=max(1, min(int(limit), 100)),
            cursor=cursor or None,
        )
        files = [
            {
                "pathname": item.pathname,
                "filename": cls.display_name(item.pathname),
                "size": item.size,
                "uploaded_at": item.uploaded_at.isoformat(),
            }
            for item in result.blobs
        ]
        files.sort(key=lambda item: item["uploaded_at"], reverse=True)
        return {
            "files": files,
            "cursor": result.cursor,
            "has_more": result.has_more,
        }

    @classmethod
    def download(cls, pathname):
        cls._require_config()
        pathname = cls._validate_pathname(pathname)
        result = get(pathname, access="private", use_cache=True)
        if result is None:
            raise FileStorageError("文件不存在")
        return result

    @classmethod
    def delete(cls, pathname):
        cls._require_config()
        pathname = cls._validate_pathname(pathname)
        delete(pathname)
