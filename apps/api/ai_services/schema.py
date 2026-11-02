from __future__ import annotations # Helps Python handle data types cleanly without breaking the code
from typing import Literal # Imports a tool to restrict values to a strict list of text options
from pydantic import BaseModel, Field # Imports foundational tools to build data validation packages and rule fields

VehicleClass = Literal["Private", "Public", "Logistics", "Unspecified"] # Defines the only 4 legal vehicle types allowed in our system database format
UrgencyProfile = Literal["Low", "Medium", "High", "Emergency"] # Defines the only 4 legal urgency states allowed to describe a ride request

class DispatchRequest(BaseModel): # Creates the main structured data package blueprint for incoming dispatch requests
    pickup_location: str = Field(..., description="Pickup point exactly as written by the user (no normalization).") # Stores the starting point text exactly as typed; the "..." means it is required
    destination_location: str = Field(..., description="Destination exactly as written by the user (no normalization).")  # Stores the destination arrival text exactly as typed; cannot be skipped
    vehicle_class: VehicleClass = Field("Unspecified", description="Requested vehicle/asset category.")  # Stores the vehicle category choice, defaulting to "Unspecified" if not found
    temporal_element: str = Field("Unspecified",description='Normalized timing: "Immediate", "Standard", an HH:MM clock time, or "Unspecified".',) # Stores the time element text or clock time, defaulting to "Unspecified"
    capacity_requirements: int = Field(1, ge=1, description="Number of passengers or cargo items. Defaults to 1.") # Stores cargo/passenger count; defaults to 1 and must be greater than or equal to 1
    urgency_profile: UrgencyProfile = Field("Low", description="Risk/urgency classification.")  # Stores the risk or urgency level of the request, defaulting to "Low"
    confidence: float = Field(...,ge=0.0,le=1.0,description="Model+heuristic confidence in this extraction. Low values should trigger human review.",)  # Stores the decimal accuracy score; must stay strictly between 0.0 and 1.0
    raw_text: str = Field(..., description="Original untouched input text, for audit trail.") # Stores the original full message text for logging and debugging purposes
    needs_review: bool = Field(False,description="True when the parse is ambiguous, low-confidence, or safety-relevant and should not be auto-dispatched.",)  # Stores a true/false checkbox to flag if a human needs to verify this request
