"""Document processing service for text extraction."""

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

# Track if we've applied the CUDA workaround
_cuda_workaround_applied = False


def _apply_cuda_workaround():
    """
    Monkey-patch torch.Tensor.to() to intercept hardcoded 'cuda' calls.

    Chandra's hf.py has `inputs = inputs.to("cuda")` hardcoded on line 31,
    which fails on Mac (no CUDA). This patch redirects 'cuda' to the
    appropriate device (MPS on Mac, CPU otherwise).
    """
    global _cuda_workaround_applied
    if _cuda_workaround_applied:
        return

    import torch

    # Determine the actual device to use
    if torch.backends.mps.is_available():
        target_device = "mps"
    elif torch.cuda.is_available():
        target_device = "cuda"
        return  # No patch needed if CUDA is available
    else:
        target_device = "cpu"

    # Store original method
    original_to = torch.Tensor.to

    def patched_to(self, *args, **kwargs):
        # Intercept .to("cuda") or .to(device="cuda") calls
        if args and isinstance(args[0], str) and args[0] == "cuda":
            args = (target_device,) + args[1:]
            logger.debug(f"Redirecting .to('cuda') to .to('{target_device}')")
        if kwargs.get("device") == "cuda":
            kwargs["device"] = target_device
            logger.debug(f"Redirecting .to(device='cuda') to .to(device='{target_device}')")
        return original_to(self, *args, **kwargs)

    torch.Tensor.to = patched_to
    _cuda_workaround_applied = True
    logger.info(f"Applied CUDA workaround: redirecting 'cuda' to '{target_device}'")


def _check_chandra_installed() -> bool:
    """Check if Chandra OCR package is installed."""
    try:
        from chandra.input import load_file
        from chandra.model import InferenceManager
        return True
    except ImportError:
        return False


def _check_chandra_model_ready() -> bool:
    """Check if Chandra OCR model is downloaded and ready."""
    try:
        from core.ocr_catalog import is_model_downloaded
        return is_model_downloaded("chandra")
    except ImportError:
        return False


def _get_chandra_model_path() -> str | None:
    """Get the path to the downloaded Chandra model."""
    try:
        from core.ocr_catalog import get_model_path, is_model_downloaded
        if is_model_downloaded("chandra"):
            path = get_model_path("chandra")
            return str(path) if path else None
    except ImportError:
        pass
    return None


def _configure_chandra_model_path():
    """Configure Chandra to use the Verbatim storage model path and correct device."""
    import torch

    # Apply CUDA workaround first (for chandra's hardcoded .to("cuda"))
    _apply_cuda_workaround()

    model_path = _get_chandra_model_path()

    # Determine device: MPS for Mac, CUDA for GPU, CPU fallback
    if torch.backends.mps.is_available():
        device = "mps"
    elif torch.cuda.is_available():
        device = "cuda"
    else:
        device = "cpu"

    # Set environment variables before importing chandra settings
    if model_path:
        os.environ["MODEL_CHECKPOINT"] = model_path
    os.environ["TORCH_DEVICE"] = device

    # Also update chandra's settings directly if already imported
    try:
        from chandra.settings import settings as chandra_settings
        if model_path:
            chandra_settings.MODEL_CHECKPOINT = model_path
        chandra_settings.TORCH_DEVICE = device
    except ImportError:
        pass


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


CHANDRA_INSTALLED = _check_chandra_installed()
PYMUPDF_AVAILABLE = _check_pymupdf_available()
PYPDF_AVAILABLE = _check_pypdf_available()


class DocumentProcessor:
    """Extracts text from various document formats."""

    def _is_chandra_available(self) -> bool:
        """Check if Chandra OCR is both installed and model is downloaded."""
        if not CHANDRA_INSTALLED:
            return False
        return _check_chandra_model_ready()

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

    def _get_chandra_config(self) -> dict:
        """Get Chandra config with model path set to Verbatim storage."""
        import torch
        model_path = _get_chandra_model_path()

        # Determine device: MPS for Mac, CUDA for GPU, CPU fallback
        if torch.backends.mps.is_available():
            device = "mps"
        elif torch.cuda.is_available():
            device = "cuda"
        else:
            device = "cpu"

        return {
            "MODEL_CHECKPOINT": model_path or "datalab-to/chandra",
            "TORCH_DEVICE": device,
        }

    def _process_pdf(self, file_path: Path) -> dict:
        """Process PDF using Chandra OCR with PyMuPDF fallback."""
        if self._is_chandra_available():
            try:
                # Configure Chandra to use Verbatim storage path
                _configure_chandra_model_path()

                from chandra.input import load_file
                from chandra.model import InferenceManager
                from chandra.model.schema import BatchInputItem

                logger.info(f"Processing {file_path.name} with Chandra OCR")

                # Load the PDF file with config
                config = self._get_chandra_config()
                pages = load_file(str(file_path), config)

                # Initialize the inference manager (uses HuggingFace by default)
                manager = InferenceManager(method="hf")

                # Create batch input items from pages with OCR layout prompt
                batch = [BatchInputItem(image=page, prompt_type="ocr_layout") for page in pages]

                # Process all pages in batch
                results = manager.generate(batch)
                markdown_parts = [result.markdown for result in results]

                combined_markdown = "\n\n".join(markdown_parts)
                # Strip markdown formatting for plain text
                plain_text = combined_markdown.replace("#", "").replace("*", "").replace("|", " ")

                return {
                    "text": plain_text,
                    "markdown": combined_markdown,
                    "page_count": len(pages),
                    "metadata": {"ocr_engine": "chandra"},
                }
            except Exception as e:
                logger.warning(f"Chandra OCR failed, falling back to PyMuPDF: {e}")
                return self._process_pdf_fallback(file_path)
        else:
            if CHANDRA_INSTALLED:
                logger.info(f"Chandra model not downloaded, using fallback for {file_path.name}")
            else:
                logger.info(f"Chandra OCR not installed, using fallback for {file_path.name}")
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
        if not self._is_chandra_available():
            if CHANDRA_INSTALLED:
                logger.warning(f"Chandra model not downloaded for image OCR: {file_path.name}")
                msg = "OCR model not downloaded. Download it in Settings > AI."
            else:
                logger.warning(f"Chandra OCR not installed for image processing: {file_path.name}")
                msg = "OCR not available"
            return {
                "text": "",
                "markdown": "",
                "page_count": 1,
                "metadata": {"error": msg},
            }

        try:
            # Configure Chandra to use Verbatim storage path
            _configure_chandra_model_path()

            from chandra.input import load_file
            from chandra.model import InferenceManager
            from chandra.model.schema import BatchInputItem

            logger.info(f"Processing {file_path.name} with Chandra OCR")

            # Load the image file with config
            config = self._get_chandra_config()
            pages = load_file(str(file_path), config)

            # Initialize the inference manager (uses HuggingFace by default)
            manager = InferenceManager(method="hf")

            # Create batch input items from pages with OCR layout prompt
            batch = [BatchInputItem(image=page, prompt_type="ocr_layout") for page in pages]

            # Process the image in batch
            results = manager.generate(batch)
            markdown_parts = [result.markdown for result in results]

            combined_markdown = "\n\n".join(markdown_parts)
            # Strip markdown formatting for plain text
            plain_text = combined_markdown.replace("#", "").replace("*", "").replace("|", " ")

            return {
                "text": plain_text,
                "markdown": combined_markdown,
                "page_count": 1,
                "metadata": {"ocr_engine": "chandra"},
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
