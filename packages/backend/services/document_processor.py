"""Document processing service for text extraction."""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class DocumentProcessor:
    """Extracts text from various document formats."""

    def process(self, file_path: Path, mime_type: str) -> dict:
        """
        Process a document and extract text content.

        Returns:
            dict with keys: text, markdown, page_count, metadata
        """
        if mime_type == "application/pdf":
            return self._process_pdf(file_path)
        elif mime_type.startswith("image/"):
            return self._process_image(file_path)
        elif mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            return self._process_docx(file_path)
        elif mime_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
            return self._process_xlsx(file_path)
        elif mime_type == "application/vnd.openxmlformats-officedocument.presentationml.presentation":
            return self._process_pptx(file_path)
        elif mime_type in ("text/plain", "text/markdown"):
            return self._process_text(file_path)
        else:
            raise ValueError(f"Unsupported MIME type: {mime_type}")

    def _process_pdf(self, file_path: Path) -> dict:
        """Process PDF using Chandra OCR."""
        try:
            from chandra_ocr import ocr
            result = ocr(str(file_path), output_format="markdown")
            return {
                "text": result.plain_text if hasattr(result, 'plain_text') else str(result),
                "markdown": result.markdown if hasattr(result, 'markdown') else str(result),
                "page_count": result.page_count if hasattr(result, 'page_count') else None,
                "metadata": {"ocr_engine": "chandra"},
            }
        except ImportError:
            logger.warning("chandra-ocr not installed, falling back to basic PDF extraction")
            return self._process_pdf_fallback(file_path)
        except Exception as e:
            logger.error(f"Chandra OCR failed: {e}")
            return self._process_pdf_fallback(file_path)

    def _process_pdf_fallback(self, file_path: Path) -> dict:
        """Fallback PDF processing using PyMuPDF or pdfplumber."""
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(file_path)
            text_parts = []
            for page in doc:
                text_parts.append(page.get_text())
            text = "\n\n".join(text_parts)
            return {
                "text": text,
                "markdown": text,
                "page_count": len(doc),
                "metadata": {"ocr_engine": "pymupdf"},
            }
        except ImportError:
            logger.warning("PyMuPDF not installed")
            return {"text": "", "markdown": "", "page_count": None, "metadata": {}}

    def _process_image(self, file_path: Path) -> dict:
        """Process image using Chandra OCR."""
        try:
            from chandra_ocr import ocr
            result = ocr(str(file_path), output_format="markdown")
            return {
                "text": result.plain_text if hasattr(result, 'plain_text') else str(result),
                "markdown": result.markdown if hasattr(result, 'markdown') else str(result),
                "page_count": 1,
                "metadata": {"ocr_engine": "chandra"},
            }
        except ImportError:
            logger.warning("chandra-ocr not installed for image processing")
            return {"text": "", "markdown": "", "page_count": 1, "metadata": {}}
        except Exception as e:
            logger.error(f"Image OCR failed: {e}")
            return {"text": "", "markdown": "", "page_count": 1, "metadata": {}}

    def _process_docx(self, file_path: Path) -> dict:
        """Process DOCX using python-docx."""
        try:
            from docx import Document as DocxDocument
            doc = DocxDocument(file_path)
            paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
            text = "\n\n".join(paragraphs)
            return {
                "text": text,
                "markdown": text,
                "page_count": None,
                "metadata": {"format": "docx"},
            }
        except ImportError:
            logger.warning("python-docx not installed")
            return {"text": "", "markdown": "", "page_count": None, "metadata": {}}
        except Exception as e:
            logger.error(f"DOCX processing failed: {e}")
            return {"text": "", "markdown": "", "page_count": None, "metadata": {}}

    def _process_xlsx(self, file_path: Path) -> dict:
        """Process XLSX using openpyxl."""
        try:
            from openpyxl import load_workbook
            wb = load_workbook(file_path, read_only=True, data_only=True)
            markdown_parts = []
            text_parts = []

            for sheet_name in wb.sheetnames:
                sheet = wb[sheet_name]
                markdown_parts.append(f"## {sheet_name}\n")
                rows = list(sheet.iter_rows(values_only=True))
                if rows:
                    # Create markdown table
                    header = rows[0]
                    markdown_parts.append("| " + " | ".join(str(c or "") for c in header) + " |")
                    markdown_parts.append("| " + " | ".join("---" for _ in header) + " |")
                    for row in rows[1:]:
                        markdown_parts.append("| " + " | ".join(str(c or "") for c in row) + " |")
                        text_parts.append("\t".join(str(c or "") for c in row))
                markdown_parts.append("")

            return {
                "text": "\n".join(text_parts),
                "markdown": "\n".join(markdown_parts),
                "page_count": len(wb.sheetnames),
                "metadata": {"format": "xlsx", "sheets": wb.sheetnames},
            }
        except ImportError:
            logger.warning("openpyxl not installed")
            return {"text": "", "markdown": "", "page_count": None, "metadata": {}}
        except Exception as e:
            logger.error(f"XLSX processing failed: {e}")
            return {"text": "", "markdown": "", "page_count": None, "metadata": {}}

    def _process_pptx(self, file_path: Path) -> dict:
        """Process PPTX using python-pptx."""
        try:
            from pptx import Presentation
            prs = Presentation(file_path)
            markdown_parts = []
            text_parts = []

            for i, slide in enumerate(prs.slides, 1):
                markdown_parts.append(f"## Slide {i}\n")
                for shape in slide.shapes:
                    if hasattr(shape, "text") and shape.text.strip():
                        markdown_parts.append(shape.text)
                        text_parts.append(shape.text)
                markdown_parts.append("")

            return {
                "text": "\n\n".join(text_parts),
                "markdown": "\n".join(markdown_parts),
                "page_count": len(prs.slides),
                "metadata": {"format": "pptx"},
            }
        except ImportError:
            logger.warning("python-pptx not installed")
            return {"text": "", "markdown": "", "page_count": None, "metadata": {}}
        except Exception as e:
            logger.error(f"PPTX processing failed: {e}")
            return {"text": "", "markdown": "", "page_count": None, "metadata": {}}

    def _process_text(self, file_path: Path) -> dict:
        """Process plain text or markdown files."""
        try:
            text = file_path.read_text(encoding="utf-8")
            return {
                "text": text,
                "markdown": text,
                "page_count": 1,
                "metadata": {"format": "text"},
            }
        except Exception as e:
            logger.error(f"Text processing failed: {e}")
            return {"text": "", "markdown": "", "page_count": 1, "metadata": {}}


document_processor = DocumentProcessor()
