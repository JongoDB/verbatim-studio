"""Document processing service for text extraction."""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def _check_chandra_available() -> bool:
    """Check if Chandra OCR is installed."""
    try:
        from chandra_ocr import ocr
        return True
    except ImportError:
        return False


def _check_pymupdf_available() -> bool:
    """Check if PyMuPDF is installed."""
    try:
        import fitz
        return True
    except ImportError:
        return False


def _check_pypdf_available() -> bool:
    """Check if pypdf is installed."""
    try:
        from pypdf import PdfReader
        return True
    except ImportError:
        return False


CHANDRA_AVAILABLE = _check_chandra_available()
PYMUPDF_AVAILABLE = _check_pymupdf_available()
PYPDF_AVAILABLE = _check_pypdf_available()


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
        """Process PDF using Chandra OCR with PyMuPDF fallback."""
        if CHANDRA_AVAILABLE:
            try:
                from chandra_ocr import ocr
                logger.info(f"Processing {file_path.name} with Chandra OCR")
                result = ocr(str(file_path), output_format="markdown")
                return {
                    "text": result.plain_text if hasattr(result, 'plain_text') else str(result),
                    "markdown": result.markdown if hasattr(result, 'markdown') else str(result),
                    "page_count": result.page_count if hasattr(result, 'page_count') else None,
                    "metadata": {
                        "ocr_engine": "chandra",
                        "ocr_confidence": getattr(result, 'confidence', None),
                    },
                }
            except Exception as e:
                logger.warning(f"Chandra OCR failed, falling back to PyMuPDF: {e}")
                return self._process_pdf_fallback(file_path)
        else:
            logger.info(f"Chandra OCR not available, using PyMuPDF for {file_path.name}")
            return self._process_pdf_fallback(file_path)

    def _process_pdf_fallback(self, file_path: Path) -> dict:
        """Fallback PDF processing using PyMuPDF or pypdf."""
        # Try PyMuPDF first
        if PYMUPDF_AVAILABLE:
            try:
                import fitz  # PyMuPDF
                logger.info(f"Processing {file_path.name} with PyMuPDF")
                doc = fitz.open(file_path)
                text_parts = []
                for page in doc:
                    text_parts.append(page.get_text())
                text = "\n\n".join(text_parts)
                page_count = len(doc)
                doc.close()
                return {
                    "text": text,
                    "markdown": text,
                    "page_count": page_count,
                    "metadata": {"ocr_engine": "pymupdf"},
                }
            except Exception as e:
                logger.warning(f"PyMuPDF processing failed, trying pypdf: {e}")

        # Try pypdf as fallback
        if PYPDF_AVAILABLE:
            try:
                from pypdf import PdfReader
                logger.info(f"Processing {file_path.name} with pypdf")
                reader = PdfReader(file_path)
                text_parts = []
                for page in reader.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text_parts.append(page_text)
                text = "\n\n".join(text_parts)
                return {
                    "text": text,
                    "markdown": text,
                    "page_count": len(reader.pages),
                    "metadata": {"ocr_engine": "pypdf"},
                }
            except Exception as e:
                logger.error(f"pypdf processing failed: {e}")

        logger.error("No PDF processing library available (install chandra-ocr, pymupdf, or pypdf)")
        return {
            "text": "",
            "markdown": "",
            "page_count": None,
            "metadata": {"error": "No PDF processor available"},
        }

    def _process_image(self, file_path: Path) -> dict:
        """Process image using Chandra OCR."""
        if not CHANDRA_AVAILABLE:
            logger.warning(f"Chandra OCR not available for image processing: {file_path.name}")
            return {
                "text": "",
                "markdown": "",
                "page_count": 1,
                "metadata": {"error": "No OCR processor available for images"},
            }

        try:
            from chandra_ocr import ocr
            logger.info(f"Processing {file_path.name} with Chandra OCR")
            result = ocr(str(file_path), output_format="markdown")
            return {
                "text": result.plain_text if hasattr(result, 'plain_text') else str(result),
                "markdown": result.markdown if hasattr(result, 'markdown') else str(result),
                "page_count": 1,
                "metadata": {
                    "ocr_engine": "chandra",
                    "ocr_confidence": getattr(result, 'confidence', None),
                },
            }
        except Exception as e:
            logger.error(f"Image OCR failed: {e}")
            return {"text": "", "markdown": "", "page_count": 1, "metadata": {"error": str(e)}}

    def _process_docx(self, file_path: Path) -> dict:
        """Process DOCX using python-docx."""
        try:
            from docx import Document as DocxDocument
            from docx.oxml.ns import qn

            doc = DocxDocument(file_path)
            markdown_parts = []
            text_parts = []

            # Helper to extract text from textboxes in a paragraph
            def extract_textbox_text(para) -> str:
                """Extract text from textboxes/shapes in a paragraph."""
                texts = []
                seen = set()
                for run in para.runs:
                    # Look for textboxContent elements
                    for txbx in run._element.findall('.//' + qn('w:txbxContent')):
                        txbx_text = []
                        for t_elem in txbx.findall('.//' + qn('w:t')):
                            if t_elem.text:
                                txbx_text.append(t_elem.text)
                        full_text = ''.join(txbx_text).strip()
                        # Avoid duplicates (some DOCX have mirrored textboxes)
                        if full_text and full_text not in seen:
                            seen.add(full_text)
                            texts.append(full_text)
                return ' '.join(texts).strip()

            # Iterate through document body to preserve order of paragraphs and tables
            for element in doc.element.body:
                if element.tag.endswith('p'):
                    # It's a paragraph
                    for para in doc.paragraphs:
                        if para._element is element:
                            # First check for textbox content (titles, etc.)
                            textbox_text = extract_textbox_text(para)
                            if textbox_text:
                                # Textbox content is often a title
                                markdown_parts.append(f"# {textbox_text}")
                                text_parts.append(textbox_text)

                            # Then check regular paragraph text (skip if same as textbox)
                            para_text = para.text.strip()
                            if para_text and para_text != textbox_text:
                                # Check if it's a heading style
                                if para.style and para.style.name.startswith('Heading'):
                                    level = para.style.name[-1] if para.style.name[-1].isdigit() else '2'
                                    markdown_parts.append(f"{'#' * int(level)} {para_text}")
                                else:
                                    markdown_parts.append(para_text)
                                text_parts.append(para_text)
                            break
                elif element.tag.endswith('tbl'):
                    # It's a table
                    for table in doc.tables:
                        if table._element is element:
                            table_md = self._table_to_markdown(table)
                            if table_md:
                                markdown_parts.append(table_md)
                                # Plain text version
                                for row in table.rows:
                                    row_text = " | ".join(cell.text.strip() for cell in row.cells)
                                    if row_text.replace("|", "").strip():
                                        text_parts.append(row_text)
                            break

            # Extract footer content
            for section in doc.sections:
                footer = section.footer
                for para in footer.paragraphs:
                    if para.text.strip():
                        markdown_parts.append(f"*{para.text}*")
                        text_parts.append(para.text)

            return {
                "text": "\n\n".join(text_parts),
                "markdown": "\n\n".join(markdown_parts),
                "page_count": None,
                "metadata": {"format": "docx"},
            }
        except ImportError:
            logger.warning("python-docx not installed")
            return {"text": "", "markdown": "", "page_count": None, "metadata": {}}
        except Exception as e:
            logger.error(f"DOCX processing failed: {e}")
            return {"text": "", "markdown": "", "page_count": None, "metadata": {}}

    def _table_to_markdown(self, table) -> str:
        """Convert a DOCX table to markdown format."""
        rows = []
        for i, row in enumerate(table.rows):
            cells = [cell.text.strip().replace('\n', ' ') for cell in row.cells]
            # Skip completely empty rows
            if not any(cells):
                continue
            rows.append("| " + " | ".join(cells) + " |")
            # Add header separator after first row
            if i == 0:
                rows.append("| " + " | ".join("---" for _ in cells) + " |")
        return "\n".join(rows) if rows else ""

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
