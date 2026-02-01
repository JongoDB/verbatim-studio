"""Document processing service for text extraction."""

import gc
import logging
import threading
from pathlib import Path
from typing import Callable

logger = logging.getLogger(__name__)


class ProcessingCancelledError(Exception):
    """Raised when document processing is cancelled."""
    pass


# Singleton for OCR model to avoid reloading
_ocr_model = None
_ocr_processor = None
_ocr_model_lock = threading.Lock()


def _get_device():
    """Get the best available device for inference."""
    import torch
    if torch.cuda.is_available():
        return "cuda"
    elif torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _get_ocr_model_path() -> str | None:
    """Get the path to the downloaded OCR model."""
    try:
        from core.ocr_catalog import get_model_path, is_model_downloaded
        if is_model_downloaded("qwen2-vl-ocr"):
            path = get_model_path("qwen2-vl-ocr")
            return str(path) if path else None
    except ImportError:
        pass
    return None


def _is_ocr_model_ready() -> bool:
    """Check if OCR model is downloaded and ready."""
    try:
        from core.ocr_catalog import is_model_downloaded
        return is_model_downloaded("qwen2-vl-ocr")
    except ImportError:
        return False


def get_ocr_model():
    """Get or create the singleton OCR model and processor."""
    global _ocr_model, _ocr_processor
    with _ocr_model_lock:
        if _ocr_model is None:
            import torch
            from transformers import Qwen2VLForConditionalGeneration, AutoProcessor

            model_path = _get_ocr_model_path()
            if not model_path:
                raise RuntimeError("OCR model not downloaded. Download it in Settings > AI.")

            device = _get_device()
            logger.info(f"Loading Qwen2-VL-OCR model from {model_path} on {device}...")

            # Load processor
            _ocr_processor = AutoProcessor.from_pretrained(
                model_path,
                trust_remote_code=True,
            )

            # Load model with appropriate settings for the device
            if device == "cuda":
                _ocr_model = Qwen2VLForConditionalGeneration.from_pretrained(
                    model_path,
                    torch_dtype=torch.bfloat16,
                    device_map="auto",
                    trust_remote_code=True,
                )
            elif device == "mps":
                # MPS doesn't support bfloat16 well, use float16
                _ocr_model = Qwen2VLForConditionalGeneration.from_pretrained(
                    model_path,
                    torch_dtype=torch.float16,
                    trust_remote_code=True,
                ).to(device)
            else:
                # CPU - use float32 for compatibility
                _ocr_model = Qwen2VLForConditionalGeneration.from_pretrained(
                    model_path,
                    torch_dtype=torch.float32,
                    trust_remote_code=True,
                )

            _ocr_model.eval()
            logger.info("Qwen2-VL-OCR model loaded successfully")

        return _ocr_model, _ocr_processor


def cleanup_ocr_model():
    """Unload the OCR model to free memory."""
    global _ocr_model, _ocr_processor
    with _ocr_model_lock:
        if _ocr_model is not None:
            logger.info("Unloading OCR model to free memory...")

            del _ocr_model
            del _ocr_processor
            _ocr_model = None
            _ocr_processor = None

            # Multiple gc.collect() calls - some objects need multiple passes
            gc.collect()
            gc.collect()
            gc.collect()

            # Clear torch caches
            try:
                import torch
                if torch.backends.mps.is_available():
                    torch.mps.synchronize()
                    torch.mps.empty_cache()
                elif torch.cuda.is_available():
                    torch.cuda.synchronize()
                    torch.cuda.empty_cache()
            except Exception as e:
                logger.debug(f"Error clearing torch cache: {e}")

            gc.collect()
            logger.info("OCR model unloaded")


def _run_ocr_on_image(image, check_cancelled: Callable[[], bool] | None = None) -> str:
    """Run OCR on a single image using Qwen2-VL-OCR."""
    import torch
    from qwen_vl_utils import process_vision_info

    if check_cancelled and check_cancelled():
        raise ProcessingCancelledError("Processing cancelled before OCR")

    model, processor = get_ocr_model()
    device = _get_device()

    # Prepare the message for OCR
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text", "text": "Extract and transcribe all text from this image. Preserve the layout and formatting as much as possible."},
            ],
        }
    ]

    # Apply chat template
    text = processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )

    # Process vision info
    image_inputs, video_inputs = process_vision_info(messages)

    # Prepare inputs
    inputs = processor(
        text=[text],
        images=image_inputs,
        videos=video_inputs,
        padding=True,
        return_tensors="pt",
    )

    # Move to device
    if device != "cpu":
        inputs = inputs.to(device)

    if check_cancelled and check_cancelled():
        raise ProcessingCancelledError("Processing cancelled during preparation")

    # Generate
    with torch.no_grad():
        generated_ids = model.generate(
            **inputs,
            max_new_tokens=2048,
            do_sample=False,
        )

    # Decode output (skip input tokens)
    generated_ids_trimmed = [
        out_ids[len(in_ids):] for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
    ]
    output_text = processor.batch_decode(
        generated_ids_trimmed,
        skip_special_tokens=True,
        clean_up_tokenization_spaces=False,
    )[0]

    return output_text


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


PYMUPDF_AVAILABLE = _check_pymupdf_available()
PYPDF_AVAILABLE = _check_pypdf_available()


class DocumentProcessor:
    """Extracts text from various document formats."""

    def _is_ocr_available(self) -> bool:
        """Check if OCR model is downloaded and ready."""
        return _is_ocr_model_ready()

    def process(
        self,
        file_path: Path,
        mime_type: str,
        enable_ocr: bool = False,
        check_cancelled: Callable[[], bool] | None = None,
    ) -> dict:
        """
        Process a document and extract text content.

        Args:
            file_path: Path to the document file
            mime_type: MIME type of the document
            enable_ocr: If True, use OCR for text extraction (for scanned docs/images)
            check_cancelled: Optional callback that returns True if processing should stop

        Returns:
            dict with keys: text, markdown, page_count, metadata

        Raises:
            ProcessingCancelledError: If processing was cancelled
        """
        if mime_type == "application/pdf":
            return self._process_pdf(file_path, enable_ocr=enable_ocr, check_cancelled=check_cancelled)
        elif mime_type.startswith("image/"):
            return self._process_image(file_path, enable_ocr=enable_ocr, check_cancelled=check_cancelled)
        elif mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            return self._process_docx(file_path, enable_ocr=enable_ocr)
        elif mime_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
            return self._process_xlsx(file_path)
        elif mime_type == "application/vnd.openxmlformats-officedocument.presentationml.presentation":
            return self._process_pptx(file_path, enable_ocr=enable_ocr)
        elif mime_type in ("text/plain", "text/markdown"):
            return self._process_text(file_path)
        else:
            raise ValueError(f"Unsupported MIME type: {mime_type}")

    def _process_pdf(
        self,
        file_path: Path,
        enable_ocr: bool = False,
        check_cancelled: Callable[[], bool] | None = None,
    ) -> dict:
        """Process PDF using OCR (if enabled) with PyMuPDF fallback."""
        if enable_ocr and self._is_ocr_available():
            try:
                if check_cancelled and check_cancelled():
                    raise ProcessingCancelledError("Processing cancelled before starting")

                logger.info(f"Processing {file_path.name} with Qwen2-VL OCR")

                # Convert PDF pages to images using PyMuPDF
                if not PYMUPDF_AVAILABLE:
                    logger.warning("PyMuPDF not available for PDF to image conversion")
                    return self._process_pdf_fallback(file_path)

                import fitz
                from PIL import Image
                import io

                doc = fitz.open(file_path)
                markdown_parts = []

                for i, page in enumerate(doc):
                    if check_cancelled and check_cancelled():
                        doc.close()
                        raise ProcessingCancelledError(f"Processing cancelled at page {i+1}/{len(doc)}")

                    logger.info(f"OCR processing page {i+1}/{len(doc)} of {file_path.name}")

                    # Render page to image (300 DPI for good OCR quality)
                    mat = fitz.Matrix(300/72, 300/72)
                    pix = page.get_pixmap(matrix=mat)
                    img_data = pix.tobytes("png")
                    image = Image.open(io.BytesIO(img_data))

                    # Run OCR on the page image
                    page_text = _run_ocr_on_image(image, check_cancelled)
                    markdown_parts.append(f"## Page {i+1}\n\n{page_text}")

                doc.close()

                combined_markdown = "\n\n".join(markdown_parts)
                plain_text = combined_markdown.replace("#", "").replace("*", "").replace("|", " ")

                return {
                    "text": plain_text,
                    "markdown": combined_markdown,
                    "page_count": len(markdown_parts),
                    "metadata": {"ocr_engine": "qwen2-vl-ocr"},
                }
            except ProcessingCancelledError:
                raise
            except Exception as e:
                logger.warning(f"OCR failed, falling back to PyMuPDF: {e}")
                return self._process_pdf_fallback(file_path)
        else:
            if enable_ocr:
                logger.info(f"OCR enabled but model not downloaded for {file_path.name}")
            else:
                logger.debug(f"OCR not enabled, using standard extraction for {file_path.name}")
            return self._process_pdf_fallback(file_path)

    def _process_pdf_fallback(self, file_path: Path) -> dict:
        """Fallback PDF processing using PyMuPDF or pypdf."""
        if PYMUPDF_AVAILABLE:
            try:
                import fitz
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

        logger.error("No PDF processing library available")
        return {
            "text": "",
            "markdown": "",
            "page_count": None,
            "metadata": {"error": "No PDF processor available"},
        }

    def _process_image(
        self,
        file_path: Path,
        enable_ocr: bool = False,
        check_cancelled: Callable[[], bool] | None = None,
    ) -> dict:
        """Process image using OCR if enabled."""
        if not enable_ocr:
            logger.debug(f"OCR not enabled for image: {file_path.name}")
            return {
                "text": "",
                "markdown": "",
                "page_count": 1,
                "metadata": {"format": "image", "ocr_enabled": False},
            }

        if not self._is_ocr_available():
            logger.warning(f"OCR model not downloaded for image: {file_path.name}")
            return {
                "text": "",
                "markdown": "",
                "page_count": 1,
                "metadata": {"error": "OCR model not downloaded. Download it in Settings > AI.", "ocr_enabled": True},
            }

        try:
            if check_cancelled and check_cancelled():
                raise ProcessingCancelledError("Processing cancelled before starting")

            from PIL import Image

            logger.info(f"Processing {file_path.name} with Qwen2-VL OCR")

            # Load image
            image = Image.open(file_path)

            # Convert to RGB if necessary (handles RGBA, grayscale, etc.)
            if image.mode != "RGB":
                image = image.convert("RGB")

            # Run OCR
            text = _run_ocr_on_image(image, check_cancelled)

            return {
                "text": text,
                "markdown": text,
                "page_count": 1,
                "metadata": {"ocr_engine": "qwen2-vl-ocr"},
            }
        except ProcessingCancelledError:
            raise
        except Exception as e:
            logger.error(f"Image OCR failed: {e}")
            return {"text": "", "markdown": "", "page_count": 1, "metadata": {"error": str(e)}}

    def _process_docx(self, file_path: Path, enable_ocr: bool = False) -> dict:
        """Process DOCX using python-docx."""
        try:
            from docx import Document as DocxDocument
            from docx.oxml.ns import qn

            doc = DocxDocument(file_path)
            markdown_parts = []
            text_parts = []

            def extract_textbox_text(para) -> str:
                """Extract text from textboxes/shapes in a paragraph."""
                texts = []
                seen = set()
                for run in para.runs:
                    for txbx in run._element.findall('.//' + qn('w:txbxContent')):
                        txbx_text = []
                        for t_elem in txbx.findall('.//' + qn('w:t')):
                            if t_elem.text:
                                txbx_text.append(t_elem.text)
                        full_text = ''.join(txbx_text).strip()
                        if full_text and full_text not in seen:
                            seen.add(full_text)
                            texts.append(full_text)
                return ' '.join(texts).strip()

            for element in doc.element.body:
                if element.tag.endswith('p'):
                    for para in doc.paragraphs:
                        if para._element is element:
                            textbox_text = extract_textbox_text(para)
                            if textbox_text:
                                markdown_parts.append(f"# {textbox_text}")
                                text_parts.append(textbox_text)

                            para_text = para.text.strip()
                            if para_text and para_text != textbox_text:
                                if para.style and para.style.name.startswith('Heading'):
                                    level = para.style.name[-1] if para.style.name[-1].isdigit() else '2'
                                    markdown_parts.append(f"{'#' * int(level)} {para_text}")
                                else:
                                    markdown_parts.append(para_text)
                                text_parts.append(para_text)
                            break
                elif element.tag.endswith('tbl'):
                    for table in doc.tables:
                        if table._element is element:
                            table_md = self._table_to_markdown(table)
                            if table_md:
                                markdown_parts.append(table_md)
                                for row in table.rows:
                                    row_text = " | ".join(cell.text.strip() for cell in row.cells)
                                    if row_text.replace("|", "").strip():
                                        text_parts.append(row_text)
                            break

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
            if not any(cells):
                continue
            rows.append("| " + " | ".join(cells) + " |")
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

    def _process_pptx(self, file_path: Path, enable_ocr: bool = False) -> dict:
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
