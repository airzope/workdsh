"""Quantize SenseVoiceSmall's MatMul weights to 4 bits for the Desktop installers.

Weight-only INT4 (ONNX Runtime MatMulNBits), blocks of 32 along the input
dimension, asymmetric with a zero point per block, round-to-nearest. Every
MatMul with a constant weight is converted; the model's metadata, which
sherpa-onnx reads, is kept. The result is byte-for-byte reproducible with the
pinned requirements.

Usage: python quantize.py <model.onnx> <output.onnx>
"""
import logging
import sys

import onnx
from onnxruntime.quantization.matmul_nbits_quantizer import DefaultWeightOnlyQuantConfig, MatMulNBitsQuantizer

BLOCK_SIZE = 32

logging.disable(logging.INFO)
source, output = sys.argv[1:3]
model = onnx.load(source)
config = DefaultWeightOnlyQuantConfig(block_size=BLOCK_SIZE, is_symmetric=False, bits=4, op_types_to_quantize=('MatMul',))
quantizer = MatMulNBitsQuantizer(model, block_size=BLOCK_SIZE, is_symmetric=False, op_types_to_quantize=('MatMul',), algo_config=config)
quantizer.process()
quantized = quantizer.model.model
if [(p.key, p.value) for p in quantized.metadata_props] != [(p.key, p.value) for p in model.metadata_props]:
    sys.exit('quantize.py: the model metadata changed')
onnx.save_model(quantized, output)
