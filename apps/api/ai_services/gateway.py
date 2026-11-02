from __future__ import annotations # Helps Python handle data types cleanly without breaking the code 
from typing import Literal # Imports a tool to limit variables to exact text choices (like strict options)
from pydantic import BaseModel, Field # Imports tools to create clean data packages and add rules/descriptions to fields
from .schema import DispatchRequest # Imports the final data blueprint that our layout must match perfectly

CONFIDENCE_THRESHOLD_TARGET = 0.85 # Sets the safety benchmark to 85% accuracy; lower scores will stop the autopilot

GatewayVerdict = Literal["CONFIDENCE_PASSED", "CONFIDENCE_BREACHED_WARNING", "STRUCTURAL_FAULT_TRIGGERED"] # Defines the only 3 legal status codes the system can return after a check
RoutingTarget = Literal["AUTONOMOUS_DISPATCH_PIPELINE", "HUMAN_DISPATCHER_QUEUE_INTERFACE"] # Defines the only 2 roads the data can take: fully automated or manual human queue

class GatewayDecision(BaseModel): # Creates a structured data container blueprint to guarantee the output format
    gateway_verdict: GatewayVerdict # Stores the strict status code result (like whether the AI passed or failed)
    routing_target: RoutingTarget # Stores the chosen road destination (automated pipeline or human queue)
    current_confidence_percentage: str = Field(..., description='Confidence formatted as a percentage string, e.g. "92.00%".') # Stores the AI score as clean text percentage; the "..." means it cannot be skipped
    system_integrity_action: str = Field(..., description="Human-readable description of the routing action taken.") # Stores a clear sentence explaining in human language why this path was chosen

def _format_percentage(score: float) -> str: # Creates a math helper tool that takes a decimal score and promises to return text
    return f"{score * 100:.2f}%" # Multiplies the score by 100, keeps exactly 2 numbers after the decimal, and adds %

def evaluate_gateway(dispatch_request: DispatchRequest) -> GatewayDecision: # Starts the traffic-cop function that takes a clean request and returns a final decision
    score = dispatch_request.confidence  # Grabs the AI's confidence score from the incoming request data
    percentage = _format_percentage(score) # Uses our math helper tool to convert the decimal score into clean percentage text
    if dispatch_request.urgency_profile == "Emergency": # Safety Check: Looks to see if the request is a critical emergency
        return GatewayDecision(gateway_verdict="CONFIDENCE_BREACHED_WARNING",routing_target="HUMAN_DISPATCHER_QUEUE_INTERFACE",current_confidence_percentage=percentage,system_integrity_action=("Automation loop halted regardless of confidence score: emergency ""urgency_profile requires human dispatcher confirmation."),) # Stops autopilot immediately and routes the emergency case to a real human queue
    if score >= CONFIDENCE_THRESHOLD_TARGET: # Standard Check: Gives a green light if the AI score is 85% or higher
        return GatewayDecision(gateway_verdict="CONFIDENCE_PASSED",routing_target="AUTONOMOUS_DISPATCH_PIPELINE",current_confidence_percentage=percentage,system_integrity_action="Bypassing verification desk. Triggering autonomous routing agent loop.",) # Bypasses human review and sends the data directly into the automated pipeline
    return GatewayDecision(gateway_verdict="CONFIDENCE_BREACHED_WARNING",routing_target="HUMAN_DISPATCHER_QUEUE_INTERFACE",current_confidence_percentage=percentage,system_integrity_action=("Automation loop halted. Forwarding unstructured metadata to Ministry manual verification desk."),) # Fallback Option: Runs automatically if the AI score is too low (below 85%)

def evaluate_gateway_from_raw(raw_payload: dict) -> GatewayDecision: # Starts the safety guard function to check raw, untrusted data from the internet API
    try: # Tells the server to run the next lines safely without crashing if an error happens
        confidence_score = raw_payload["confidence_score"] # Looks inside the incoming raw packet to find the confidence score field
        if not isinstance(confidence_score, (int, float)) or isinstance(confidence_score, bool): # Type Check: Makes sure the score is a real math number, not words or a checkbox
            raise TypeError("confidence_score must be a number") # Logical Check: Makes sure the number is normal and stays between 0.0 and 1.0
        if not (0.0 <= float(confidence_score) <= 1.0): 
            raise ValueError("confidence_score out of range [0.0, 1.0]")
        initial_payload = raw_payload["initial_payload"] # Grabs the main request data package located inside the raw payload
        dispatch_request = DispatchRequest(**initial_payload,confidence=float(confidence_score),raw_text=initial_payload.get("raw_text", ""),)  # Attempts to pack this cleaned raw data into our strict internal system model
    except Exception as exc: # Safety Net: Catches any broken data structure, missing fields, or validation errors
        return GatewayDecision(gateway_verdict="STRUCTURAL_FAULT_TRIGGERED",routing_target="HUMAN_DISPATCHER_QUEUE_INTERFACE",current_confidence_percentage="0.00%",system_integrity_action=(f"Malformed or invalid input payload ({type(exc).__name__}: {exc}). ""Routing bypassed entirely; forwarding raw payload to human dispatcher queue."),)

    return evaluate_gateway(dispatch_request)
