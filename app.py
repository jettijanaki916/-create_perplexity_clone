import os
import io
import json
import numpy as np
import PyPDF2
from flask import Flask, request, jsonify, Response, render_template, url_for
from flask_cors import CORS
from dotenv import load_dotenv
from google import genai
from google.genai import types

# Load environment variables
load_dotenv()

app = Flask(__name__, template_folder='templates', static_folder='static')
# Enable CORS (though less critical now that we serve from same origin)
CORS(app)

# Initialize the Gemini GenAI client
try:
    client = genai.Client()
except Exception as e:
    print(f"Failed to initialize GenAI client. Ensure GEMINI_API_KEY is set. Error: {e}")
    client = None

# Global in-memory storage for RAG document vectors
document_chunks = []

def extract_text_from_pdf(file_stream):
    """Extracts all text from a passing PyPDF2 stream."""
    try:
        reader = PyPDF2.PdfReader(file_stream)
        text = ""
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
        return text
    except Exception as e:
        print(f"Error extracting PDF: {e}")
        return ""

def chunk_text(text, chunk_size=1000, overlap=200):
    """Splits text into overlapping chunks."""
    chunks = []
    start = 0
    text_length = len(text)
    while start < text_length:
        end = start + chunk_size
        chunks.append(text[start:end])
        start += chunk_size - overlap
    return chunks

def cosine_similarity(vec1, vec2):
    """Calculates cosine similarity between two numeric vectors."""
    dot_product = np.dot(vec1, vec2)
    norm_vec1 = np.linalg.norm(vec1)
    norm_vec2 = np.linalg.norm(vec2)
    if norm_vec1 == 0 or norm_vec2 == 0:
        return 0.0
    return dot_product / (norm_vec1 * norm_vec2)

# Search Mode System Prompts
SYSTEM_PROMPTS = {
    "all": "You are a helpful, concise AI assistant. Answer the user's question clearly.",
    "academic": "You are an Academic Researcher. Provide detailed, well-structured answers with a focus on facts and logical reasoning. Use a formal tone.",
    "concise": "You are a highly efficient assistant. Provide the shortest possible accurate answer. No fluff, no filler.",
    "creative": "You are a creative storyteller and brainstormer. Provide imaginative, engaging, and descriptive responses. Be expressive!"
}

@app.route('/')
def index():
    """Serve the main frontend page."""
    return render_template('index.html')

@app.route('/api/upload', methods=['POST'])
def upload_file():
    global document_chunks
    if not client: return jsonify({"error": "GenAI client not initialized."}), 500
    if 'file' not in request.files: return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({"error": "No selected file"}), 400
    
    if file and file.filename.endswith('.pdf'):
        try:
            document_chunks = []
            pdf_text = extract_text_from_pdf(io.BytesIO(file.read()))
            if not pdf_text.strip(): return jsonify({"error": "Empty PDF"}), 400
            
            chunks_text = chunk_text(pdf_text)
            for chunk in chunks_text:
                embedding_response = client.models.embed_content(model='gemini-embedding-001', contents=chunk)
                document_chunks.append({"text": chunk, "embedding": embedding_response.embeddings[0].values})
            return jsonify({"message": f"Successfully processed {file.filename}."})
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    return jsonify({"error": "Unsupported file"}), 400

@app.route('/api/chat', methods=['POST'])
def chat():
    if not client: return jsonify({"error": "Client not initialized"}), 500
    data = request.json
    if not data or 'prompt' not in data: return jsonify({"error": "No prompt"}), 400
    
    user_prompt = data['prompt']
    mode = data.get('mode', 'all').lower()
    system_instruction = SYSTEM_PROMPTS.get(mode, SYSTEM_PROMPTS['all'])
    
    retrieved_context = ""
    
    try:
        # RAG Retrieval logic
        if document_chunks:
            q_emb = client.models.embed_content(model='gemini-embedding-001', contents=user_prompt)
            query_vec = q_emb.embeddings[0].values
            
            scored = sorted([(cosine_similarity(query_vec, c["embedding"]), c["text"]) for c in document_chunks], key=lambda x: x[0], reverse=True)
            context_pieces = [f"Snippet (relevance {round(s,2)}): {t}" for s, t in scored[:3] if s > 0.4]
            if context_pieces:
                retrieved_context = "\n\n".join(context_pieces)
        
        final_prompt = user_prompt
        if retrieved_context:
            final_prompt = f"Use the following context to answer:\n{retrieved_context}\n\nQuestion: {user_prompt}\nAnswer:"

        # STREAMING GENERATION
        def generate():
            response_stream = client.models.generate_content_stream(
                model='gemini-2.5-flash',
                contents=final_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction
                )
            )
            for chunk in response_stream:
                if chunk.text:
                    # Send chunk in SSE format
                    yield f"data: {json.dumps({'text': chunk.text})}\n\n"
            yield "data: [DONE]\n\n"

        return Response(generate(), mimetype='text/event-stream')

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # Run the server on port 5000
    app.run(debug=True, port=5000)
