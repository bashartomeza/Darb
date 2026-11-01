from __future__ import annotations # Helps Python handle data types cleanly without breaking the code
import json # Imports the built-in JSON tool to format and print output data nicely
import os # Imports the operating system tool to check server files or keys
from .pipeline import parse_dispatch_request # Imports the main processing function from our pipeline file

SAMPLE_INPUTS = ["بدنا تكتك قوام يسحب كرتونتين كبار من عند دوار المناررة وننزلهم بمكتب البريد المركزي والوضع مستعجل","في واحد مجروح عند الشفاا بدنا اسعاف قوام","بدي سيرفيس من بيت لحم للخليل الساعة 16:00",] # Lists real Palestinian dialect text messages used to test if our system parses data correctly

def main() -> None: # Starts the main execution function to run our live system demonstration tests
    mock_notice = "" if os.environ.get("OPENAI_API_KEY") else " (MOCK_MODE: no OPENAI_API_KEY set, using local heuristic extractor)"  # Checks if the OpenAI key is missing and creates a warning text if we are in mock mode
    print(f"Darb dispatch NLP engine -- demo run{mock_notice}\n") # Prints the main heading text of the demo program into the terminal console screen
   for text in SAMPLE_INPUTS: # Loops through each sample Arabic text message stored inside our testing list 
        result = parse_dispatch_request(text) # Sends the current raw text message into our main pipeline function to extract data 
        print(f"INPUT: {text}") # Prints the original untouched input message onto the console screen
        print(json.dumps(result.model_dump(), ensure_ascii=False, indent=2)) # Formats the extracted data dictionary into a clean, readable JSON layout and prints it 
        print("-" * 60) # Prints a simple dashed line string to separate different testing results visually
if __name__ == "__main__": # Standard Python rule to automatically start the main function when running this file directly
    main() # Calls the main function to trigger the whole system test run loop
