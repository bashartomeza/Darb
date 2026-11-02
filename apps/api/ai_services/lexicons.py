from __future__ import annotations # Helps Python handle data types cleanly without breaking the code
import re # Imports the Regular Expressions tool to search text for specific Arabic patterns
from .schema import VehicleClass # Imports the strict enum layout that defines legal vehicle class choices

EMERGENCY_KEYWORDS = ["مجروح", "مصيبة", "حالة طارئة", "بنزف", "مستشفى قوام", "في خطر","اسعاف", "إسعاف", "خطر على حياته", "طوارئ",] # Lists critical Arabic words that mean someone is hurt or in immediate danger
IMMEDIATE_TIME_KEYWORDS = ["هسا", "قوام", "طير", "بسرعة", "قوام قوام", "هلقيت", "الوضع مستعجل",] # Lists Palestinian dialect words that mean the user needs a ride right now, ASAP
VEHICLE_KEYWORDS: dict[VehicleClass, list[str]] = {"Logistics": ["تكتك", "شاحنة", "باص شحن", "سيارة نقل", "غراض المحل", "بضاعة", "طرد"],"Private": ["خصوصي", "طلب", "تكسي طلبا", "ملاكي"],"Public": ["عمومي", "سيرفيس", "باص خط"],} # Groups specific words by vehicle categories like cargo trucks or private taxis
ARABIC_DIGIT_MAP = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789") # Creates a text translator tool to convert Eastern Arabic numbers into standard Western numbers
DUAL_SUFFIX_PATTERN = re.compile(r"\b\w*(?:ين|تين)\b")   # Prepares a pattern to search for Arabic words ending with dual markers (two items)
CLOCK_TIME_PATTERN = re.compile(r"\b([01]?\d|2[0-3]):([0-5]\d)\b") # Prepares a pattern to look for standard digital clock times like 14:30 or 2:15

def detect_emergency(text: str) -> bool: # Starts the function to scan user text for life-safety emergency situations
    return any(keyword in text for keyword in EMERGENCY_KEYWORDS) # Returns True if even one critical danger word is found inside the raw message

def detect_immediate_time(text: str) -> bool: # Starts the function to scan user text for urgent time requests like "now" or "ASAP"
    return any(keyword in text for keyword in IMMEDIATE_TIME_KEYWORDS) # Returns True if even one quick-response keyword is found inside the raw message

def detect_vehicle_class(text: str) -> VehicleClass: # Starts the function to scan user text and figure out the requested vehicle type
    for vehicle_class, keywords in VEHICLE_KEYWORDS.items(): # Loops through each vehicle category and its list of regional dialect keywords
        if any(keyword in text for keyword in keywords): # Checks if any keyword from the current category exists inside the user's message
            return vehicle_class #  Returns the matching category immediately if a keyword is spotted
    return "Unspecified"  # Returns a default label if no vehicle types were mentioned in the text

def extract_capacity(text: str) -> int: # Starts the function to extract package capacity numbers or passenger counts from text
    normalized = text.translate(ARABIC_DIGIT_MAP) # Converts any Eastern Arabic digits in the text into standard Western numbers
    normalized_no_time = CLOCK_TIME_PATTERN.sub(" ", normalized) # Erases any digital clock times like 12:30 so they do not get confused for sizes
    digit_match = re.search(r"\b(\d{1,3})\b", normalized_no_time) # Searches for a standalone number that is between 1 and 3 digits long
    if digit_match: # Checks if a regular number was successfully found in the cleaned text
        return int(digit_match.group(1))  # Converts the found number text into a math integer and returns it
    if DUAL_SUFFIX_PATTERN.search(text): # Checks if any words in the original message end with Arabic dual markers (meaning two items)
        return 2 # Automatically returns 2 because the wording indicates a pair of things
    return 1 # Returns 1 as the default fallback count if no specific numbers were found

def extract_clock_time(text: str) -> str | None: # Starts the function to search the text for a standard clock time configuration
    match = CLOCK_TIME_PATTERN.search(text) # Searches the message for a digital clock format match like 2:15 or 14:30
    if match: # Checks if a clock time pattern was successfully spotted in the text
        return f"{int(match.group(1)):02d}:{match.group(2)}" # Formats the hour to always use 2 digits and pairs it with the found minutes
    return None  # Returns nothing if no digital clock formats were present in the message

def apply_safety_layer(text: str, llm_urgency: str) -> str: # Starts the safety function that compares text against the AI's urgency choice
    if detect_emergency(text): # Checks if our local dictionary rules find any critical life-safety danger words
        return "Emergency" # Overrides the AI and forces the safety status to "Emergency" immediately
    return llm_urgency # Keeps and returns the AI's original urgency decision if no danger words were tripped
